"""
media index — Sibling Discovery Engine
Guaranteed-existence sibling discovery pipeline with zero-404 verification.
Multi-strategy engine:
  1. DirectoryIndexStrategy: Exposed directory listing scraping (Apache/Nginx/Caddy)
  2. NumericSequenceStrategy: Number sequence and zero-padded sequence detection
  3. DatePatternStrategy: ISO, compact, underscore, and year-month calendar adjacency
  4. QualitySuffixStrategy: CDN size/resolution/quality descriptor substitution
  5. ConventionVariantStrategy: Retina/DPI variants (@2x, @3x), format conversions, and icon ladders
  6. AlphaSequenceStrategy: Single-letter alphabetical sequences
"""

import datetime
from html.parser import HTMLParser
import os
import re
from typing import Optional, Dict, Any, List, Tuple
from urllib.parse import urlsplit, urlunsplit, urljoin, unquote
import httpx

# Domains/hosts identified as standalone media hashes without sequential folder structures
STANDALONE_CDN_HOSTS = {
    "i.redd.it",
    "preview.redd.it",
    "v.redd.it",
    "pbs.twimg.com",
    "cdn.discordapp.com",
    "media.discordapp.net",
    "images.unsplash.com",
    "media.giphy.com",
    "tenor.com",
    "i.pinimg.com"
}

KNOWN_MEDIA_EXTENSIONS = {
    "jpg", "jpeg", "png", "webp", "gif", "svg", "avif", "bmp", "ico",
    "mp4", "webm", "mov", "m4v", "ogv", "avi", "mkv",
    "mp3", "wav", "ogg", "m4a", "aac", "flac"
}

SIZE_SUFFIXES = [
    # Descriptive size names
    "large", "lg", "medium", "med", "small", "sm", "tiny",
    "xlarge", "xl", "xxlarge", "xxl", "full", "half", "quarter",
    # Resolution shorthand
    "2x", "3x", "4x", "1x", "hd", "sd", "uhd", "4k",
    # Quality descriptors
    "hq", "lq", "hi", "lo", "max", "min", "compressed", "optimized",
    # Thumbnail / preview markers
    "thumb", "thumbnail", "preview", "poster",
]

COMMON_SIZE_PROBES = ["thumb", "small", "medium", "large", "xl", "preview", "poster", "hd", "full"]

ICON_LADDER = [16, 24, 32, 48, 64, 96, 128, 192, 256, 512]


class DirectoryListingParser(HTMLParser):
    """Extracts href links from HTML directory listing pages."""
    def __init__(self):
        super().__init__()
        self.links: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]):
        if tag.lower() == "a":
            for k, v in attrs:
                if k.lower() == "href" and v:
                    self.links.append(v.strip())


class SiblingEngine:
    """Zero-404 Multi-Strategy Sibling Discovery Engine for media URLs."""

    def __init__(self, probe_timeout: float = 2.5, max_workers: int = 5):
        self.probe_timeout = probe_timeout
        self.max_workers = max_workers

    @staticmethod
    def is_standalone_asset(url: str) -> Tuple[bool, str]:
        """Determines if a URL belongs to a standalone CDN host or isolated hash scheme.
        Returns (is_standalone, reason).
        """
        try:
            parts = urlsplit(url)
            host = (parts.netloc or "").lower().split(":")[0]

            for cdn_domain in STANDALONE_CDN_HOSTS:
                if host == cdn_domain or host.endswith("." + cdn_domain):
                    return True, f"Host '{host}' is an isolated hash CDN with no navigable sibling structure."

            if "imgur.com" in host and not parts.path.startswith("/a/"):
                return True, "Imgur standalone asset without an album sequence."

            return False, ""
        except Exception as e:
            return False, str(e)

    @staticmethod
    def extract_sequence_pattern(url: str) -> Optional[Dict[str, Any]]:
        """Analyzes a media URL filename for embedded numeric sequence patterns.
        E.g.:
          '.../gallery/photo_04.jpg' -> prefix='photo_', num=4, pad=2, suffix=''
          '.../page-008-hq.png'      -> prefix='page-', num=8, pad=3, suffix='-hq'
        """
        try:
            parts = urlsplit(url)
            path = unquote(parts.path)
            if not path or path.endswith("/"):
                return None

            dir_path, filename = os.path.split(path)
            stem, ext = os.path.splitext(filename)
            ext_clean = ext.lstrip(".").lower()

            if not stem:
                return None

            # Pattern: prefix + number + suffix
            match = re.search(r"^(.*?)(\d+)([^\d]*)$", stem)
            if not match:
                return None

            prefix, num_str, suffix = match.groups()
            seed_num = int(num_str)
            pad_len = len(num_str) if num_str.startswith("0") and len(num_str) > 1 else 0

            return {
                "scheme": parts.scheme,
                "netloc": parts.netloc,
                "dir_path": dir_path,
                "prefix": prefix,
                "seed_num": seed_num,
                "num_str": num_str,
                "pad_len": pad_len,
                "suffix": suffix,
                "ext": ext,
                "clean_ext": ext_clean,
                "query": parts.query
            }
        except Exception:
            return None

    @staticmethod
    def build_candidate_url(pattern: Dict[str, Any], target_num: int) -> str:
        """Constructs candidate URL for a target integer based on the parsed pattern."""
        if pattern["pad_len"] > 0:
            formatted_num = str(target_num).zfill(pattern["pad_len"])
        else:
            formatted_num = str(target_num)

        new_filename = f"{pattern['prefix']}{formatted_num}{pattern['suffix']}{pattern['ext']}"
        new_path = f"{pattern['dir_path']}/{new_filename}".replace("//", "/")

        return urlunsplit((
            pattern["scheme"],
            pattern["netloc"],
            new_path,
            pattern["query"],
            ""
        ))

    def probe_url(self, client: httpx.Client, candidate_url: str) -> Optional[Dict[str, Any]]:
        """Tests if candidate URL genuinely exists on the source server
        and returns valid media headers.
        """
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "image/*,video/*,audio/*,*/*;q=0.8"
        }

        try:
            # 1. Attempt lightweight HEAD probe
            res = client.head(candidate_url, headers=headers, follow_redirects=True, timeout=self.probe_timeout)

            # If HEAD is disallowed by CDN/server (405), fallback to Range GET for first 512 bytes
            if res.status_code == 405:
                range_headers = {**headers, "Range": "bytes=0-512"}
                res = client.get(candidate_url, headers=range_headers, follow_redirects=True, timeout=self.probe_timeout)

            # Verification rule: Status must be 200, 206, or 304
            if res.status_code not in (200, 206, 304):
                return None

            content_type = (res.headers.get("Content-Type") or "").lower().split(";")[0].strip()
            content_length = res.headers.get("Content-Length")
            last_modified = res.headers.get("Last-Modified")

            try:
                size_bytes = int(content_length) if content_length else None
            except ValueError:
                size_bytes = None

            # Verify it's actually media
            ext = os.path.splitext(urlsplit(candidate_url).path)[1].lstrip(".").lower()
            is_media_mime = content_type.startswith(("image/", "video/", "audio/"))
            is_media_ext = ext in KNOWN_MEDIA_EXTENSIONS

            if not (is_media_mime or is_media_ext):
                return None

            filename = os.path.basename(unquote(urlsplit(candidate_url).path))

            return {
                "url": candidate_url,
                "filename": filename,
                "extension": ext or "media",
                "status_code": res.status_code,
                "mime_type": content_type or f"media/{ext}",
                "size_bytes": size_bytes,
                "last_modified": last_modified
            }

        except Exception:
            return None

    # -------------------------------------------------------------
    # Strategy 1: Directory Index Scraping
    # -------------------------------------------------------------
    def discover_directory_index(self, client: httpx.Client, seed_url: str, max_probes: int = 40) -> List[Dict[str, Any]]:
        """Scrapes directory index listing (Apache / Nginx / Caddy / Python http.server)
        at parent folder URL to discover sibling assets.
        """
        try:
            parts = urlsplit(seed_url)
            if not parts.scheme or not parts.netloc:
                return []

            path = unquote(parts.path)
            dir_path = os.path.dirname(path)
            if not dir_path.endswith("/"):
                dir_path += "/"

            dir_url = urlunsplit((parts.scheme, parts.netloc, dir_path, "", ""))
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            }

            res = client.get(dir_url, headers=headers, follow_redirects=True, timeout=self.probe_timeout)
            if res.status_code != 200:
                return []

            ct = (res.headers.get("Content-Type") or "").lower()
            if "text/html" not in ct and "application/xhtml" not in ct:
                return []

            parser = DirectoryListingParser()
            parser.feed(res.text)

            candidate_urls = []
            seen_cand = set()

            for href in parser.links:
                # Ignore query params, anchors, parent directory links
                if href.startswith("?") or href.startswith("#") or href in ("../", "./"):
                    continue
                abs_url = urljoin(dir_url, href)
                # Strip query and fragments for normalization check
                cand_parts = urlsplit(abs_url)
                if cand_parts.netloc.lower() != parts.netloc.lower():
                    continue

                clean_cand_path = unquote(cand_parts.path)
                cand_ext = os.path.splitext(clean_cand_path)[1].lstrip(".").lower()
                if cand_ext not in KNOWN_MEDIA_EXTENSIONS:
                    continue

                if abs_url == seed_url or abs_url in seen_cand:
                    continue

                seen_cand.add(abs_url)
                candidate_urls.append(abs_url)
                if len(candidate_urls) >= max_probes:
                    break

            verified = []
            for cand_url in candidate_urls:
                info = self.probe_url(client, cand_url)
                if info:
                    info["is_seed"] = False
                    info["strategy"] = "directory_index"
                    info["discovery_type"] = "directory_listed"
                    verified.append(info)

            return verified
        except Exception:
            return []

    # -------------------------------------------------------------
    # Strategy 2: Numeric Sequence
    # -------------------------------------------------------------
    def discover_numeric_sequence(
        self,
        client: httpx.Client,
        pattern: Dict[str, Any],
        max_forward: int = 15,
        max_backward: int = 10,
        max_consecutive_misses: int = 2
    ) -> List[Dict[str, Any]]:
        """Probes forward and backward numerical sequences from seed integer."""
        seed_num = pattern["seed_num"]
        verified: List[Dict[str, Any]] = []

        # Forward sweep
        consecutive_misses = 0
        for offset in range(1, max_forward + 1):
            target = seed_num + offset
            cand_url = self.build_candidate_url(pattern, target)
            info = self.probe_url(client, cand_url)
            if info:
                info["is_seed"] = False
                info["sequence_num"] = target
                info["strategy"] = "numeric_sequence"
                info["discovery_type"] = "forward_sweep"
                verified.append(info)
                consecutive_misses = 0
            else:
                consecutive_misses += 1
                if consecutive_misses >= max_consecutive_misses:
                    break

        # Backward sweep
        consecutive_misses = 0
        for offset in range(1, max_backward + 1):
            target = seed_num - offset
            if target < 0:
                break
            cand_url = self.build_candidate_url(pattern, target)
            info = self.probe_url(client, cand_url)
            if info:
                info["is_seed"] = False
                info["sequence_num"] = target
                info["strategy"] = "numeric_sequence"
                info["discovery_type"] = "backward_sweep"
                verified.append(info)
                consecutive_misses = 0
            else:
                consecutive_misses += 1
                if consecutive_misses >= max_consecutive_misses:
                    break

        verified.sort(key=lambda s: s.get("sequence_num", 0))
        return verified

    # -------------------------------------------------------------
    # Strategy 3: Date Pattern Siblings
    # -------------------------------------------------------------
    def discover_date_patterns(self, client: httpx.Client, seed_url: str, max_days_window: int = 7) -> List[Dict[str, Any]]:
        """Detects calendar dates in filename (YYYY-MM-DD, YYYY_MM_DD, YYYYMMDD, YYYY-MM)
        and probes adjacent date siblings.
        """
        try:
            parts = urlsplit(seed_url)
            path = unquote(parts.path)
            dir_path, filename = os.path.split(path)
            stem, ext = os.path.splitext(filename)
            if not stem:
                return []

            date_match = None
            date_fmt = None
            date_obj = None

            # 1. ISO format: 2024-03-15
            m_iso = re.search(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)", stem)
            if m_iso:
                try:
                    y, m, d = int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3))
                    date_obj = datetime.date(y, m, d)
                    date_match = m_iso
                    date_fmt = "iso"
                except ValueError:
                    pass

            # 2. Underscore format: 2024_03_15
            if not date_obj:
                m_und = re.search(r"(?<!\d)(\d{4})_(\d{2})_(\d{2})(?!\d)", stem)
                if m_und:
                    try:
                        y, m, d = int(m_und.group(1)), int(m_und.group(2)), int(m_und.group(3))
                        date_obj = datetime.date(y, m, d)
                        date_match = m_und
                        date_fmt = "und"
                    except ValueError:
                        pass

            # 3. Compact format: 20240315
            if not date_obj:
                m_cmp = re.search(r"(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)", stem)
                if m_cmp:
                    try:
                        y, m, d = int(m_cmp.group(1)), int(m_cmp.group(2)), int(m_cmp.group(3))
                        if 1990 <= y <= 2040 and 1 <= m <= 12 and 1 <= d <= 31:
                            date_obj = datetime.date(y, m, d)
                            date_match = m_cmp
                            date_fmt = "cmp"
                    except ValueError:
                        pass

            if not date_obj or not date_match:
                return []

            orig_date_str = date_match.group(0)
            verified: List[Dict[str, Any]] = []

            # Probe adjacent days (-max_days_window to +max_days_window)
            day_offsets = [o for o in range(-max_days_window, max_days_window + 1) if o != 0]
            # Prioritize closer dates first
            day_offsets.sort(key=lambda x: abs(x))

            for offset in day_offsets:
                target_date = date_obj + datetime.timedelta(days=offset)
                if date_fmt == "iso":
                    new_date_str = target_date.strftime("%Y-%m-%d")
                elif date_fmt == "und":
                    new_date_str = target_date.strftime("%Y_%m_%d")
                else:
                    new_date_str = target_date.strftime("%Y%m%d")

                new_stem = stem[:date_match.start()] + new_date_str + stem[date_match.end():]
                new_filename = f"{new_stem}{ext}"
                new_path = f"{dir_path}/{new_filename}".replace("//", "/")
                cand_url = urlunsplit((parts.scheme, parts.netloc, new_path, parts.query, ""))

                if cand_url == seed_url:
                    continue

                info = self.probe_url(client, cand_url)
                if info:
                    info["is_seed"] = False
                    info["strategy"] = "date_pattern"
                    info["discovery_type"] = "date_adjacent"
                    info["date_offset"] = offset
                    verified.append(info)

            return verified
        except Exception:
            return []

    # -------------------------------------------------------------
    # Strategy 4: Quality / Size Suffix Substitution
    # -------------------------------------------------------------
    def discover_quality_suffixes(self, client: httpx.Client, seed_url: str) -> List[Dict[str, Any]]:
        """Identifies known size/quality tokens (large, thumb, 2x, etc.) in filename
        and probes variant substitutions.
        """
        try:
            parts = urlsplit(seed_url)
            path = unquote(parts.path)
            dir_path, filename = os.path.split(path)
            stem, ext = os.path.splitext(filename)
            if not stem:
                return []

            # Check if stem ends with separator + known size suffix (e.g. photo-large, banner_thumb)
            m = re.search(r"^(.*?)([-_@~.])([a-zA-Z0-9]+)$", stem)
            if not m:
                return []

            base_stem, sep, raw_token = m.groups()
            token_lower = raw_token.lower()

            if token_lower not in SIZE_SUFFIXES:
                return []

            # Candidate suffixes to test
            candidates_to_try = [s for s in COMMON_SIZE_PROBES if s != token_lower]
            # Also try the clean base stem without any size suffix
            candidates_urls = [
                urlunsplit((parts.scheme, parts.netloc, f"{dir_path}/{base_stem}{ext}".replace("//", "/"), parts.query, ""))
            ]

            for s in candidates_to_try:
                # Match casing of original token
                repl_token = s.upper() if raw_token.isupper() else s
                new_stem = f"{base_stem}{sep}{repl_token}"
                cand_url = urlunsplit((parts.scheme, parts.netloc, f"{dir_path}/{new_stem}{ext}".replace("//", "/"), parts.query, ""))
                candidates_urls.append(cand_url)

            verified = []
            for cand_url in candidates_urls:
                if cand_url == seed_url:
                    continue
                info = self.probe_url(client, cand_url)
                if info:
                    info["is_seed"] = False
                    info["strategy"] = "quality_suffix"
                    info["discovery_type"] = "suffix_variant"
                    verified.append(info)

            return verified
        except Exception:
            return []

    # -------------------------------------------------------------
    # Strategy 5: Common Naming Convention Variants
    # -------------------------------------------------------------
    def discover_convention_variants(self, client: httpx.Client, seed_url: str) -> List[Dict[str, Any]]:
        """Probes standard asset conventions:
          5a. Retina / DPI variants (@2x, @3x, -2x, _2x)
          5b. Format alternate extensions (webp, avif, png, jpg)
          5c. Icon size ladder (16, 24, 32, 48, 64, 128, etc.)
        """
        try:
            parts = urlsplit(seed_url)
            path = unquote(parts.path)
            dir_path, filename = os.path.split(path)
            stem, ext = os.path.splitext(filename)
            clean_ext = ext.lstrip(".").lower()
            if not stem:
                return []

            candidate_urls: List[Tuple[str, str]] = []  # (url, discovery_type)

            # 5a. Retina variants
            if "@2x" in stem:
                candidate_urls.append((
                    urlunsplit((parts.scheme, parts.netloc, f"{dir_path}/{stem.replace('@2x', '@3x')}{ext}".replace("//", "/"), parts.query, "")),
                    "retina_variant"
                ))
                candidate_urls.append((
                    urlunsplit((parts.scheme, parts.netloc, f"{dir_path}/{stem.replace('@2x', '')}{ext}".replace("//", "/"), parts.query, "")),
                    "retina_variant"
                ))
            elif "@3x" in stem:
                candidate_urls.append((
                    urlunsplit((parts.scheme, parts.netloc, f"{dir_path}/{stem.replace('@3x', '@2x')}{ext}".replace("//", "/"), parts.query, "")),
                    "retina_variant"
                ))
                candidate_urls.append((
                    urlunsplit((parts.scheme, parts.netloc, f"{dir_path}/{stem.replace('@3x', '')}{ext}".replace("//", "/"), parts.query, "")),
                    "retina_variant"
                ))
            else:
                for ret in ("@2x", "@3x"):
                    candidate_urls.append((
                        urlunsplit((parts.scheme, parts.netloc, f"{dir_path}/{stem}{ret}{ext}".replace("//", "/"), parts.query, "")),
                        "retina_variant"
                    ))

            # 5b. Format extension variants (only for common image formats)
            image_formats = ["webp", "png", "jpg", "jpeg", "avif"]
            if clean_ext in image_formats:
                alt_formats = [f for f in ["webp", "png", "jpg", "avif"] if f != clean_ext and not (f in ("jpg", "jpeg") and clean_ext in ("jpg", "jpeg"))]
                for alt_f in alt_formats:
                    candidate_urls.append((
                        urlunsplit((parts.scheme, parts.netloc, f"{dir_path}/{stem}.{alt_f}".replace("//", "/"), parts.query, "")),
                        "format_variant"
                    ))

            # 5c. Icon size ladder
            ladder_match = re.search(r"[-_](\d{2,3})\b", stem)
            if ladder_match:
                try:
                    val = int(ladder_match.group(1))
                    if val in ICON_LADDER:
                        idx = ICON_LADDER.index(val)
                        ladder_targets = []
                        if idx > 0:
                            ladder_targets.append(ICON_LADDER[idx - 1])
                        if idx < len(ICON_LADDER) - 1:
                            ladder_targets.append(ICON_LADDER[idx + 1])
                        if idx + 2 < len(ICON_LADDER):
                            ladder_targets.append(ICON_LADDER[idx + 2])

                        for target_dim in ladder_targets:
                            new_stem = stem[:ladder_match.start(1)] + str(target_dim) + stem[ladder_match.end(1):]
                            candidate_urls.append((
                                urlunsplit((parts.scheme, parts.netloc, f"{dir_path}/{new_stem}{ext}".replace("//", "/"), parts.query, "")),
                                "icon_ladder"
                            ))
                except ValueError:
                    pass

            verified = []
            seen = set()
            for cand_url, disc_type in candidate_urls:
                if cand_url == seed_url or cand_url in seen:
                    continue
                seen.add(cand_url)
                info = self.probe_url(client, cand_url)
                if info:
                    info["is_seed"] = False
                    info["strategy"] = "convention_variant"
                    info["discovery_type"] = disc_type
                    verified.append(info)

            return verified
        except Exception:
            return []

    # -------------------------------------------------------------
    # Strategy 6: Alphabetical Sequence
    # -------------------------------------------------------------
    def discover_alpha_sequences(self, client: httpx.Client, seed_url: str, max_consecutive_misses: int = 2) -> List[Dict[str, Any]]:
        """Detects single-letter alphabetical sequence (page-a, file_b)
        and probes adjacent alphabetical siblings.
        """
        try:
            parts = urlsplit(seed_url)
            path = unquote(parts.path)
            dir_path, filename = os.path.split(path)
            stem, ext = os.path.splitext(filename)
            if not stem:
                return []

            # Only trigger on single-letter stem OR prefix + separator + single letter
            m = re.search(r"^(.*[-_.])([a-zA-Z])$", stem)
            if m:
                prefix = m.group(1)
                letter = m.group(2)
            elif len(stem) == 1 and stem.isalpha():
                prefix = ""
                letter = stem
            else:
                return []

            is_upper = letter.isupper()
            base_ord = ord('A') if is_upper else ord('a')
            current_idx = ord(letter) - base_ord  # 0 to 25

            verified: List[Dict[str, Any]] = []

            # Forward alphabetical sweep (up to 8 letters forward)
            consecutive_misses = 0
            for offset in range(1, 9):
                target_idx = current_idx + offset
                if target_idx > 25:
                    break
                target_letter = chr(base_ord + target_idx)
                cand_stem = f"{prefix}{target_letter}"
                cand_url = urlunsplit((parts.scheme, parts.netloc, f"{dir_path}/{cand_stem}{ext}".replace("//", "/"), parts.query, ""))
                info = self.probe_url(client, cand_url)
                if info:
                    info["is_seed"] = False
                    info["strategy"] = "alpha_sequence"
                    info["discovery_type"] = "alpha_adjacent"
                    verified.append(info)
                    consecutive_misses = 0
                else:
                    consecutive_misses += 1
                    if consecutive_misses >= max_consecutive_misses:
                        break

            # Backward alphabetical sweep (up to 4 letters backward)
            consecutive_misses = 0
            for offset in range(1, 5):
                target_idx = current_idx - offset
                if target_idx < 0:
                    break
                target_letter = chr(base_ord + target_idx)
                cand_stem = f"{prefix}{target_letter}"
                cand_url = urlunsplit((parts.scheme, parts.netloc, f"{dir_path}/{cand_stem}{ext}".replace("//", "/"), parts.query, ""))
                info = self.probe_url(client, cand_url)
                if info:
                    info["is_seed"] = False
                    info["strategy"] = "alpha_sequence"
                    info["discovery_type"] = "alpha_adjacent"
                    verified.append(info)
                    consecutive_misses = 0
                else:
                    consecutive_misses += 1
                    if consecutive_misses >= max_consecutive_misses:
                        break

            return verified
        except Exception:
            return []

    # -------------------------------------------------------------
    # Main Multi-Strategy Orchestration
    # -------------------------------------------------------------
    def discover_siblings(
        self,
        raw_url: str,
        max_forward: int = 15,
        max_backward: int = 10,
        max_consecutive_misses: int = 2,
        client: Optional[httpx.Client] = None
    ) -> Dict[str, Any]:
        """Main discovery method: orchestrates all discovery strategies in priority order."""
        # 1. Standalone Check
        is_standalone, reason = self.is_standalone_asset(raw_url)
        if is_standalone:
            return {
                "status": "standalone",
                "reason": reason,
                "seed_url": raw_url,
                "strategy": "standalone_filter",
                "strategies_run": ["standalone_filter"],
                "pattern_description": None,
                "total_verified": 0,
                "siblings": []
            }

        verified_by_url: Dict[str, Dict[str, Any]] = {}
        strategies_successful: List[str] = []
        pattern_descriptions: List[str] = []

        def execute_all(http_client: httpx.Client):
            # Priority 1: Directory Index Scraping
            dir_results = self.discover_directory_index(http_client, raw_url)
            if dir_results:
                strategies_successful.append("directory_index")
                pattern_descriptions.append("Exposed directory listing")
                for item in dir_results:
                    if item["url"] not in verified_by_url:
                        verified_by_url[item["url"]] = item

                # Short-circuit rule: If directory listing found 3+ files, folder is fully exposed
                if len(dir_results) >= 3:
                    return

            # Priority 2: Date Pattern Siblings (checked before plain numeric so calendar dates handle month/leap year arithmetic)
            date_results = self.discover_date_patterns(http_client, raw_url)
            if date_results:
                strategies_successful.append("date_pattern")
                pattern_descriptions.append("Calendar date adjacency")
                for item in date_results:
                    if item["url"] not in verified_by_url:
                        verified_by_url[item["url"]] = item

            # Priority 3: Numeric Sequence Pattern
            numeric_pattern = self.extract_sequence_pattern(raw_url)
            if numeric_pattern:
                num_results = self.discover_numeric_sequence(
                    http_client,
                    numeric_pattern,
                    max_forward=max_forward,
                    max_backward=max_backward,
                    max_consecutive_misses=max_consecutive_misses
                )
                if num_results:
                    strategies_successful.append("numeric_sequence")
                    pad_desc = f"{numeric_pattern['pad_len']} digits" if numeric_pattern['pad_len'] else "plain integer"
                    pattern_descriptions.append(
                        f"Numeric sequence: '{numeric_pattern['prefix']}[N]{numeric_pattern['suffix']}{numeric_pattern['ext']}' ({pad_desc})"
                    )
                    for item in num_results:
                        if item["url"] not in verified_by_url:
                            verified_by_url[item["url"]] = item

            # Priority 4: Quality / Size Suffixes
            suffix_results = self.discover_quality_suffixes(http_client, raw_url)
            if suffix_results:
                strategies_successful.append("quality_suffix")
                pattern_descriptions.append("Size / quality variants")
                for item in suffix_results:
                    if item["url"] not in verified_by_url:
                        verified_by_url[item["url"]] = item

            # Priority 5: Convention Variants (retina, format, icon ladder)
            conv_results = self.discover_convention_variants(http_client, raw_url)
            if conv_results:
                strategies_successful.append("convention_variant")
                pattern_descriptions.append("Media convention variants")
                for item in conv_results:
                    if item["url"] not in verified_by_url:
                        verified_by_url[item["url"]] = item

            # Priority 6: Alphabetical Sequence
            alpha_results = self.discover_alpha_sequences(http_client, raw_url)
            if alpha_results:
                strategies_successful.append("alpha_sequence")
                pattern_descriptions.append("Alphabetical sequence")
                for item in alpha_results:
                    if item["url"] not in verified_by_url:
                        verified_by_url[item["url"]] = item

        if client is not None:
            execute_all(client)
        else:
            with httpx.Client(verify=False, timeout=self.probe_timeout) as default_client:
                execute_all(default_client)

        if not verified_by_url:
            return {
                "status": "no_pattern",
                "reason": "No numerical sequence, date, quality suffix, or convention siblings found on server.",
                "seed_url": raw_url,
                "strategy": "none",
                "strategies_run": [],
                "pattern_description": None,
                "total_verified": 0,
                "siblings": []
            }

        verified_siblings = list(verified_by_url.values())
        # Sort by sequence number if numeric, else by filename
        verified_siblings.sort(key=lambda s: (s.get("sequence_num") is None, s.get("sequence_num", 0), s.get("filename", "")))

        primary_strategy = strategies_successful[0] if strategies_successful else "multi_strategy"

        return {
            "status": "success",
            "strategy": primary_strategy,
            "strategies_run": strategies_successful,
            "seed_url": raw_url,
            "pattern_description": " • ".join(pattern_descriptions),
            "total_verified": len(verified_siblings),
            "siblings": verified_siblings
        }

    # -------------------------------------------------------------
    # Folder-Level Multi-Seed Discovery
    # -------------------------------------------------------------
    def discover_folder_siblings(
        self,
        folder_path: str,
        domain: str,
        urls: List[str],
        max_forward: int = 15,
        max_backward: int = 10,
        max_consecutive_misses: int = 2,
        client: Optional[httpx.Client] = None
    ) -> Dict[str, Any]:
        """Probes missing sibling media files across all existing files in a directory/folder."""
        if not urls:
            return {
                "status": "error",
                "message": "No URLs provided in folder.",
                "folder_path": folder_path,
                "domain": domain,
                "total_verified": 0,
                "siblings": []
            }

        # Check if all files in folder are on standalone CDNs
        standalone_checks = [self.is_standalone_asset(u) for u in urls]
        if all(chk[0] for chk in standalone_checks):
            return {
                "status": "standalone",
                "reason": standalone_checks[0][1] or "All assets in this folder are hosted on isolated CDNs.",
                "folder_path": folder_path,
                "domain": domain,
                "total_verified": 0,
                "siblings": []
            }

        known_urls = set(urls)
        discovered_by_url: Dict[str, Dict[str, Any]] = {}
        pattern_descriptions: List[str] = []
        strategies_successful: List[str] = []

        def execute_folder_probes(http_client: httpx.Client):
            # 1. Directory Index Scraping on folder
            sample_url = urls[0]
            dir_results = self.discover_directory_index(http_client, sample_url)
            if dir_results:
                strategies_successful.append("directory_index")
                pattern_descriptions.append("Directory listing")
                for item in dir_results:
                    if item["url"] not in known_urls and item["url"] not in discovered_by_url:
                        discovered_by_url[item["url"]] = item

            # 2. Group Numeric Sequences
            pattern_groups: Dict[tuple, Dict[str, Any]] = {}
            for u in urls:
                pat = self.extract_sequence_pattern(u)
                if not pat:
                    continue
                sig = (pat["dir_path"], pat["prefix"], pat["suffix"], pat["pad_len"], pat["ext"])
                if sig not in pattern_groups:
                    pattern_groups[sig] = {
                        "pattern": pat,
                        "known_nums": set(),
                        "known_urls": set()
                    }
                pattern_groups[sig]["known_nums"].add(pat["seed_num"])
                pattern_groups[sig]["known_urls"].add(u)

            if pattern_groups:
                strategies_successful.append("numeric_sequence")
                for sig, group in pattern_groups.items():
                    pat = group["pattern"]
                    known_nums = group["known_nums"]
                    group_known_urls = group["known_urls"]
                    min_num = min(known_nums)
                    max_num = max(known_nums)

                    pad_desc = f"{pat['pad_len']} digits" if pat['pad_len'] else "plain integer"
                    pattern_descriptions.append(
                        f"'{pat['prefix']}[N]{pat['suffix']}{pat['ext']}' (seeds: {min_num}-{max_num}, {pad_desc})"
                    )

                    # Internal Sequence Gaps
                    for target in range(min_num + 1, max_num):
                        if target not in known_nums:
                            cand_url = self.build_candidate_url(pat, target)
                            if cand_url not in known_urls and cand_url not in discovered_by_url:
                                info = self.probe_url(http_client, cand_url)
                                if info:
                                    info["is_seed"] = False
                                    info["sequence_num"] = target
                                    info["strategy"] = "numeric_sequence"
                                    info["discovery_type"] = "gap_fill"
                                    discovered_by_url[cand_url] = info

                    # Forward Sweep
                    consecutive_misses = 0
                    for offset in range(1, max_forward + 1):
                        target = max_num + offset
                        if target in known_nums:
                            continue
                        cand_url = self.build_candidate_url(pat, target)
                        if cand_url in known_urls or cand_url in discovered_by_url:
                            continue
                        info = self.probe_url(http_client, cand_url)
                        if info:
                            info["is_seed"] = False
                            info["sequence_num"] = target
                            info["strategy"] = "numeric_sequence"
                            info["discovery_type"] = "forward_sweep"
                            discovered_by_url[cand_url] = info
                            consecutive_misses = 0
                        else:
                            consecutive_misses += 1
                            if consecutive_misses >= max_consecutive_misses:
                                break

                    # Backward Sweep
                    consecutive_misses = 0
                    for offset in range(1, max_backward + 1):
                        target = min_num - offset
                        if target < 0:
                            break
                        if target in known_nums:
                            continue
                        cand_url = self.build_candidate_url(pat, target)
                        if cand_url in known_urls or cand_url in discovered_by_url:
                            continue
                        info = self.probe_url(http_client, cand_url)
                        if info:
                            info["is_seed"] = False
                            info["sequence_num"] = target
                            info["strategy"] = "numeric_sequence"
                            info["discovery_type"] = "backward_sweep"
                            discovered_by_url[cand_url] = info
                            consecutive_misses = 0
                        else:
                            consecutive_misses += 1
                            if consecutive_misses >= max_consecutive_misses:
                                break

            # 3. Quality suffix & Date patterns on individual seed files
            for u in urls[:10]:
                for d_item in self.discover_date_patterns(http_client, u):
                    if d_item["url"] not in known_urls and d_item["url"] not in discovered_by_url:
                        discovered_by_url[d_item["url"]] = d_item
                        if "date_pattern" not in strategies_successful:
                            strategies_successful.append("date_pattern")

                for q_item in self.discover_quality_suffixes(http_client, u):
                    if q_item["url"] not in known_urls and q_item["url"] not in discovered_by_url:
                        discovered_by_url[q_item["url"]] = q_item
                        if "quality_suffix" not in strategies_successful:
                            strategies_successful.append("quality_suffix")

        if client is not None:
            execute_folder_probes(client)
        else:
            with httpx.Client(verify=False, timeout=self.probe_timeout) as default_client:
                execute_folder_probes(default_client)

        if not discovered_by_url:
            return {
                "status": "no_pattern",
                "reason": "No additional sibling files discovered in this folder.",
                "folder_path": folder_path,
                "domain": domain,
                "total_verified": 0,
                "siblings": []
            }

        verified_siblings = list(discovered_by_url.values())
        verified_siblings.sort(key=lambda s: (s.get("sequence_num") is None, s.get("sequence_num", 0), s.get("filename", "")))

        return {
            "status": "success",
            "strategy": "folder_multi_seed",
            "strategies_run": strategies_successful,
            "folder_path": folder_path,
            "domain": domain,
            "total_seed_files": len(urls),
            "patterns_detected": pattern_descriptions,
            "pattern_description": " • ".join(pattern_descriptions) if pattern_descriptions else "Folder multi-strategy scan",
            "total_verified": len(verified_siblings),
            "siblings": verified_siblings
        }
