"""
Cluster Engine - Smart Duplicate Clustering & Canonical URL Detection.
Groups URLs pointing to identical or duplicate media assets across different CDNs,
mirrors, paths, or query variants.
"""
from __future__ import annotations
import hashlib
import io
import os
import re
from urllib.parse import urlparse, parse_qsl
from typing import Dict, List, Any, Optional

try:
    import imagehash
    from PIL import Image
    IMAGEHASH_AVAILABLE = True
except ImportError:
    imagehash = None
    Image = None
    IMAGEHASH_AVAILABLE = False


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
THUMB_CACHE_DIR = os.path.join(BASE_DIR, "static", "thumb_cache")


class ClusterEngine:
    """Detects and clusters duplicate media URLs with confidence scoring."""

    @staticmethod
    def compute_image_hash(image_input: Any) -> Optional[str]:
        """Computes a 64-bit perceptual dHash hex string from a PIL Image, bytes, or file path.
        Returns a 16-character hex string, or None if the image cannot be processed.
        """
        if not IMAGEHASH_AVAILABLE or Image is None:
            return None
        try:
            if isinstance(image_input, bytes):
                img = Image.open(io.BytesIO(image_input))
            elif isinstance(image_input, str):
                if not os.path.isfile(image_input):
                    return None
                img = Image.open(image_input)
            elif isinstance(image_input, Image.Image):
                img = image_input
            else:
                return None

            return str(imagehash.dhash(img))
        except Exception:
            return None

    @staticmethod
    def hamming_distance(hash1_str: str, hash2_str: str) -> int:
        """Calculates the Hamming bit distance between two hexadecimal perceptual hashes.
        Values <= 4 indicate visually identical or near-duplicate media.
        """
        if not hash1_str or not hash2_str:
            return 999
        try:
            if IMAGEHASH_AVAILABLE and imagehash:
                h1 = imagehash.hex_to_hash(hash1_str)
                h2 = imagehash.hex_to_hash(hash2_str)
                return h1 - h2
            # Fallback bitwise calculation
            v1 = int(hash1_str, 16)
            v2 = int(hash2_str, 16)
            return bin(v1 ^ v2).count("1")
        except Exception:
            return 999

    @staticmethod
    def _normalize_domain(domain: str) -> str:
        """Strips common CDN and mirror subdomains (e.g. cdn1., images., plus., preview.)
        to resolve to the base canonical origin domain.
        """
        if not domain:
            return ""
        d = domain.lower().strip().split(":")[0]

        cdn_prefixes = (
            "cdn.", "cdn1.", "cdn2.", "cdn3.", "images.", "plus.",
            "media.", "static.", "preview.", "assets.", "upload.",
            "i.", "s3.", "r2."
        )
        for prefix in cdn_prefixes:
            if d.startswith(prefix) and len(d) > len(prefix) + 3:
                d = d[len(prefix):]
                break
        return d

    @classmethod
    def _extract_path_stem(cls, entry: Dict[str, Any]) -> str:
        """Extracts a normalized path pattern or asset ID stem from an entry.
        Removes extension and common platform asset prefixes (e.g. photo-, premium_photo-, v0-).
        """
        url = entry.get("url", "")
        parsed = urlparse(url)
        path = parsed.path.rstrip("/")
        if not path:
            return "/"

        segments = [s for s in path.split("/") if s]
        if not segments:
            return "/"

        filename = segments[-1]
        name_no_ext, _ = os.path.splitext(filename)

        normalized_stem = re.sub(r'^(premium_photo|photo|v0)-', '', name_no_ext, flags=re.IGNORECASE)

        if len(segments) > 1:
            parent_path = "/".join(segments[:-1])
            return f"{parent_path}/{normalized_stem.lower()}"
        return normalized_stem.lower()

    @staticmethod
    def _score_for_canonical(entry: Dict[str, Any]) -> int:
        """Scores an entry to determine which URL should be selected as the canonical representative.
        Higher score = more likely to be the pristine canonical asset.
        Heuristics:
          + 500 points if dimensions exist (width * height scaled)
          + 300 points for query width parameter (e.g. ?w=2560 > ?w=600)
          + 100 points for HTTPS over HTTP
          + 50 points if URL has no tracking query parameters
          + 50 points if count/repeats is higher
          - penalty for query string length
          - penalty for deeply nested paths
        """
        score = 0
        url = entry.get("url", "")
        meta = entry.get("metadata", {}) or {}

        # 1. Dimensions / Quality from probed metadata
        width = meta.get("width")
        height = meta.get("height")
        if isinstance(width, int) and isinstance(height, int) and width > 0 and height > 0:
            score += min(500, int((width * height) ** 0.5))

        # 2. Query resolution hints (e.g. w=1080, width=2560)
        w_match = re.search(r'(?:[?&]|\b)(?:w|width)=(\d+)', url, re.IGNORECASE)
        if w_match:
            try:
                score += min(300, int(w_match.group(1)) // 10)
            except ValueError:
                pass

        # 3. HTTPS preference
        if url.startswith("https://"):
            score += 100

        # 4. Clean URL bonus / tracking query penalty
        parsed = urlparse(url)
        if parsed.query:
            query_params = parse_qsl(parsed.query, keep_blank_values=True)
            tracking_keys = {"utm_source", "utm_medium", "utm_campaign", "fbclid", "gclid", "token", "sig", "expires"}
            tracking_count = sum(1 for k, _ in query_params if k.lower() in tracking_keys)
            score -= (tracking_count * 50)
            score -= min(50, len(parsed.query))
        else:
            score += 50

        # 5. Submission count
        count = entry.get("count", 1)
        score += min(50, count * 5)

        # 6. Path length penalty
        path = parsed.path or ""
        score -= min(30, len(path.split("/")))

        return score

    def find_clusters(self, entries: List[Dict[str, Any]] | Dict[str, Dict[str, Any]], dismissed_cluster_ids: set = None) -> List[Dict[str, Any]]:
        """Identifies duplicate clusters across the provided entries.

        Evaluation pipeline:
        1. High Confidence: Exact filename + exact Content-Length match.
        2. High Confidence: Perceptual Hash match (dHash Hamming distance <= 4).
        3. Medium Confidence: Path-segment pattern match after domain normalization.
        """
        if dismissed_cluster_ids is None:
            dismissed_cluster_ids = set()

        url_list: List[Dict[str, Any]] = []
        if isinstance(entries, dict):
            for k, v in entries.items():
                if isinstance(v, dict):
                    item = dict(v)
                    item.setdefault("url", k)
                    url_list.append(item)
        elif isinstance(entries, list):
            url_list = [dict(e) for e in entries if isinstance(e, dict) and e.get("url")]

        if len(url_list) < 2:
            return []

        clusters: List[Dict[str, Any]] = []
        assigned_urls = set()

        # -------------------------------------------------------------
        # 1. High Confidence: Exact (filename.lower(), content_length)
        # -------------------------------------------------------------
        size_filename_buckets: Dict[tuple[str, int], List[Dict[str, Any]]] = {}

        for entry in url_list:
            filename = (entry.get("filename") or "").strip().lower()
            meta = entry.get("metadata") or {}
            content_length = meta.get("content_length")

            if filename and filename != "/" and isinstance(content_length, int) and content_length > 0:
                key = (filename, content_length)
                size_filename_buckets.setdefault(key, []).append(entry)

        for (filename, size), items in size_filename_buckets.items():
            if len(items) >= 2:
                unique_items_by_url: Dict[str, Dict[str, Any]] = {}
                for it in items:
                    u = it.get("url")
                    if u and u not in unique_items_by_url:
                        unique_items_by_url[u] = it

                unique_items = list(unique_items_by_url.values())
                if len(unique_items) < 2:
                    continue

                sorted_items = sorted(unique_items, key=self._score_for_canonical, reverse=True)
                canonical_entry = sorted_items[0]
                canonical_url = canonical_entry["url"]

                cluster_hash = hashlib.sha256(f"high_{filename}_{size}".encode("utf-8")).hexdigest()[:12]
                cluster_id = f"clus_{cluster_hash}"
                if cluster_id in dismissed_cluster_ids:
                    for it in sorted_items:
                        assigned_urls.add(it["url"])
                    continue

                item_payloads = []
                for idx, it in enumerate(sorted_items):
                    is_canon = (idx == 0)
                    assigned_urls.add(it["url"])
                    meta = it.get("metadata") or {}
                    w = meta.get("width")
                    h = meta.get("height")
                    fn = it.get("filename") or filename
                    item_payloads.append({
                        "url": it.get("url"),
                        "domain": it.get("domain", ""),
                        "filename": fn,
                        "name": fn,
                        "content_length": size,
                        "size_bytes": size,
                        "content_type": meta.get("content_type", ""),
                        "width": w,
                        "height": h,
                        "dimensions": [w, h] if w and h else None,
                        "metadata": meta,
                        "count": it.get("count", 1),
                        "is_canonical": is_canon
                    })

                clusters.append({
                    "cluster_id": cluster_id,
                    "confidence": "high",
                    "match_rule": "filename_and_size",
                    "reason": f"Exact match on filename '{filename}' and Content-Length ({size} bytes)",
                    "canonical_url": canonical_url,
                    "canonical": item_payloads[0],
                    "duplicates": item_payloads[1:],
                    "items": item_payloads,
                    "duplicate_count": len(item_payloads) - 1,
                    "total_variants": len(item_payloads) - 1,
                    "savings_bytes": size * (len(item_payloads) - 1),
                    "potential_savings_bytes": size * (len(item_payloads) - 1)
                })

        # -------------------------------------------------------------
        # 2. High Confidence: Perceptual Hash match (dHash distance <= 4)
        # -------------------------------------------------------------
        entries_with_phash = []
        for entry in url_list:
            u = entry.get("url", "")
            if not u or u in assigned_urls:
                continue

            meta = entry.get("metadata") or {}
            ph = meta.get("phash") or meta.get("dhash") or meta.get("image_hash") or meta.get("hash")

            # Check cached thumbnail if phash not explicitly set
            if not ph and THUMB_CACHE_DIR and os.path.isdir(THUMB_CACHE_DIR):
                for sz in (150, 480, 160):
                    raw = f"{u.strip()}_{sz}".encode("utf-8")
                    h_name = hashlib.sha256(raw).hexdigest()
                    thumb_path = os.path.join(THUMB_CACHE_DIR, f"{h_name}.webp")
                    if os.path.isfile(thumb_path):
                        ph = self.compute_image_hash(thumb_path)
                        if ph:
                            break

            if ph:
                entries_with_phash.append((entry, str(ph).strip().lower()))

        if len(entries_with_phash) >= 2:
            visited_indices = set()
            for i in range(len(entries_with_phash)):
                if i in visited_indices:
                    continue
                entry_a, hash_a = entries_with_phash[i]
                group = [entry_a]
                visited_indices.add(i)

                for j in range(i + 1, len(entries_with_phash)):
                    if j in visited_indices:
                        continue
                    entry_b, hash_b = entries_with_phash[j]
                    dist = self.hamming_distance(hash_a, hash_b)
                    if dist <= 4:
                        group.append(entry_b)
                        visited_indices.add(j)

                if len(group) >= 2:
                    unique_by_url = {}
                    for it in group:
                        u = it.get("url")
                        if u and u not in unique_by_url:
                            unique_by_url[u] = it

                    unique_items = list(unique_by_url.values())
                    if len(unique_items) < 2:
                        continue

                    sorted_items = sorted(unique_items, key=self._score_for_canonical, reverse=True)
                    canonical_entry = sorted_items[0]
                    canonical_url = canonical_entry["url"]

                    cluster_hash = hashlib.sha256(f"phash_{canonical_url}".encode("utf-8")).hexdigest()[:12]
                    cluster_id = f"clus_{cluster_hash}"
                    if cluster_id in dismissed_cluster_ids:
                        for it in sorted_items:
                            assigned_urls.add(it["url"])
                        continue

                    item_payloads = []
                    total_redundant_bytes = 0
                    for idx, it in enumerate(sorted_items):
                        is_canon = (idx == 0)
                        assigned_urls.add(it["url"])
                        meta = it.get("metadata") or {}
                        cl = meta.get("content_length", 0)
                        if not is_canon and isinstance(cl, int):
                            total_redundant_bytes += cl

                        w = meta.get("width")
                        h = meta.get("height")
                        fn = it.get("filename", "")
                        item_payloads.append({
                            "url": it.get("url"),
                            "domain": it.get("domain", ""),
                            "filename": fn,
                            "name": fn,
                            "content_length": cl if isinstance(cl, int) else None,
                            "size_bytes": cl if isinstance(cl, int) else None,
                            "content_type": meta.get("content_type", ""),
                            "width": w,
                            "height": h,
                            "dimensions": [w, h] if w and h else None,
                            "metadata": meta,
                            "count": it.get("count", 1),
                            "is_canonical": is_canon
                        })

                    clusters.append({
                        "cluster_id": cluster_id,
                        "confidence": "high",
                        "match_rule": "perceptual_hash",
                        "reason": "Visually identical images matched by perceptual hash (Hamming distance <= 4)",
                        "canonical_url": canonical_url,
                        "canonical": item_payloads[0],
                        "duplicates": item_payloads[1:],
                        "items": item_payloads,
                        "duplicate_count": len(item_payloads) - 1,
                        "total_variants": len(item_payloads) - 1,
                        "savings_bytes": total_redundant_bytes,
                        "potential_savings_bytes": total_redundant_bytes
                    })

        # -------------------------------------------------------------
        # 3. Medium Confidence: Path-segment pattern after domain normalization
        # -------------------------------------------------------------
        pattern_buckets: Dict[tuple[str, str], List[Dict[str, Any]]] = {}

        for entry in url_list:
            u = entry.get("url", "")
            if not u or u in assigned_urls:
                continue

            raw_domain = entry.get("domain") or urlparse(u).netloc
            norm_domain = self._normalize_domain(raw_domain)
            path_stem = self._extract_path_stem(entry)

            if norm_domain and path_stem and path_stem != "/" and len(path_stem) >= 3:
                key = (norm_domain, path_stem)
                pattern_buckets.setdefault(key, []).append(entry)

        for (norm_domain, path_stem), items in pattern_buckets.items():
            if len(items) >= 2:
                unique_items_by_url: Dict[str, Dict[str, Any]] = {}
                for it in items:
                    u = it.get("url")
                    if u and u not in unique_items_by_url:
                        unique_items_by_url[u] = it

                unique_items = list(unique_items_by_url.values())
                if len(unique_items) < 2:
                    continue

                sorted_items = sorted(unique_items, key=self._score_for_canonical, reverse=True)
                canonical_entry = sorted_items[0]
                canonical_url = canonical_entry["url"]

                cluster_hash = hashlib.sha256(f"med_{norm_domain}_{path_stem}".encode("utf-8")).hexdigest()[:12]
                cluster_id = f"clus_{cluster_hash}"
                if cluster_id in dismissed_cluster_ids:
                    for it in sorted_items:
                        assigned_urls.add(it["url"])
                    continue

                item_payloads = []
                total_redundant_bytes = 0
                for idx, it in enumerate(sorted_items):
                    is_canon = (idx == 0)
                    assigned_urls.add(it["url"])
                    meta = it.get("metadata") or {}
                    cl = meta.get("content_length", 0)
                    if not is_canon and isinstance(cl, int):
                        total_redundant_bytes += cl

                    w = meta.get("width")
                    h = meta.get("height")
                    fn = it.get("filename", "")
                    item_payloads.append({
                        "url": it.get("url"),
                        "domain": it.get("domain", ""),
                        "filename": fn,
                        "name": fn,
                        "content_length": cl if isinstance(cl, int) else None,
                        "size_bytes": cl if isinstance(cl, int) else None,
                        "content_type": meta.get("content_type", ""),
                        "width": w,
                        "height": h,
                        "dimensions": [w, h] if w and h else None,
                        "metadata": meta,
                        "count": it.get("count", 1),
                        "is_canonical": is_canon
                    })

                clusters.append({
                    "cluster_id": cluster_id,
                    "confidence": "medium",
                    "match_rule": "path_segment_pattern",
                    "reason": f"Shared path pattern '{path_stem}' across {norm_domain}",
                    "canonical_url": canonical_url,
                    "canonical": item_payloads[0],
                    "duplicates": item_payloads[1:],
                    "items": item_payloads,
                    "duplicate_count": len(item_payloads) - 1,
                    "total_variants": len(item_payloads) - 1,
                    "savings_bytes": total_redundant_bytes,
                    "potential_savings_bytes": total_redundant_bytes
                })

        confidence_rank = {"high": 0, "medium": 1, "low": 2}
        clusters.sort(key=lambda c: (
            confidence_rank.get(c.get("confidence", "low"), 9),
            -c.get("savings_bytes", 0),
            -c.get("duplicate_count", 0)
        ))

        return clusters
