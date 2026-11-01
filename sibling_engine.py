"""
media index — Sibling Discovery Engine
Guaranteed-existence sibling discovery pipeline with zero-404 verification.
Detects numerical sequence patterns, probes candidate assets via HTTP HEAD,
and enforces strict verification and standalone CDN classification.
"""

import os
import re
from typing import Optional, Dict, Any, List, Tuple
from urllib.parse import urlsplit, urlunsplit, unquote
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


class SiblingEngine:
    """Zero-404 Sibling Discovery Engine for media URLs."""

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

    def discover_siblings(
        self,
        raw_url: str,
        max_forward: int = 15,
        max_backward: int = 10,
        max_consecutive_misses: int = 2,
        client: Optional[httpx.Client] = None
    ) -> Dict[str, Any]:
        """Main discovery method: validates existence of sibling media files."""
        # 1. Standalone Check
        is_standalone, reason = self.is_standalone_asset(raw_url)
        if is_standalone:
            return {
                "status": "standalone",
                "reason": reason,
                "seed_url": raw_url,
                "strategy": "standalone_filter",
                "pattern_description": None,
                "total_verified": 0,
                "siblings": []
            }

        # 2. Pattern Analysis
        pattern = self.extract_sequence_pattern(raw_url)
        if not pattern:
            return {
                "status": "no_pattern",
                "reason": "No numerical sequence or navigable pattern detected in URL filename.",
                "seed_url": raw_url,
                "strategy": "none",
                "pattern_description": None,
                "total_verified": 0,
                "siblings": []
            }

        seed_num = pattern["seed_num"]
        verified_siblings: List[Dict[str, Any]] = []

        def execute_with_client(http_client: httpx.Client):
            # Probe Forward (seed_num + 1, seed_num + 2, ...)
            consecutive_misses = 0
            for offset in range(1, max_forward + 1):
                target = seed_num + offset
                cand_url = self.build_candidate_url(pattern, target)
                info = self.probe_url(http_client, cand_url)
                if info:
                    info["is_seed"] = False
                    info["sequence_num"] = target
                    verified_siblings.append(info)
                    consecutive_misses = 0
                else:
                    consecutive_misses += 1
                    if consecutive_misses >= max_consecutive_misses:
                        break

            # Probe Backward (seed_num - 1, seed_num - 2, ...)
            consecutive_misses = 0
            for offset in range(1, max_backward + 1):
                target = seed_num - offset
                if target < 0:
                    break
                cand_url = self.build_candidate_url(pattern, target)
                info = self.probe_url(http_client, cand_url)
                if info:
                    info["is_seed"] = False
                    info["sequence_num"] = target
                    verified_siblings.append(info)
                    consecutive_misses = 0
                else:
                    consecutive_misses += 1
                    if consecutive_misses >= max_consecutive_misses:
                        break

        if client is not None:
            execute_with_client(client)
        else:
            with httpx.Client(verify=False, timeout=self.probe_timeout) as default_client:
                execute_with_client(default_client)

        # Sort discovered siblings by sequence number
        verified_siblings.sort(key=lambda s: s.get("sequence_num", 0))

        pad_desc = f"{pattern['pad_len']} digits" if pattern['pad_len'] else "plain integer"
        desc = f"Sequence pattern: '{pattern['prefix']}[N]{pattern['suffix']}{pattern['ext']}' ({pad_desc})"

        return {
            "status": "success",
            "strategy": "numeric_sequence",
            "seed_url": raw_url,
            "pattern_description": desc,
            "total_verified": len(verified_siblings),
            "siblings": verified_siblings
        }

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
        """Probes missing sibling media files across all existing files in a directory/folder.
        Analyzes multi-seed sequences, fills internal gaps, and sweeps forward/backward boundaries.
        """
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
                "reason": standalone_checks[0][1] or "All assets in this folder are hosted on isolated CDNs with no sequential sibling structure.",
                "folder_path": folder_path,
                "domain": domain,
                "total_verified": 0,
                "siblings": []
            }

        # Group valid patterns
        # Signature: (dir_path, prefix, suffix, pad_len, ext)
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

        if not pattern_groups:
            return {
                "status": "no_pattern",
                "reason": "No numeric sequence patterns (e.g., photo_01.jpg) found among the media files in this folder.",
                "folder_path": folder_path,
                "domain": domain,
                "total_verified": 0,
                "siblings": []
            }

        discovered_by_url: Dict[str, Dict[str, Any]] = {}
        pattern_descriptions: List[str] = []

        def execute_folder_probes(http_client: httpx.Client):
            for sig, group in pattern_groups.items():
                pat = group["pattern"]
                known_nums = group["known_nums"]
                known_urls = group["known_urls"]
                min_num = min(known_nums)
                max_num = max(known_nums)

                pad_desc = f"{pat['pad_len']} digits" if pat['pad_len'] else "plain integer"
                pattern_descriptions.append(
                    f"'{pat['prefix']}[N]{pat['suffix']}{pat['ext']}' (seeds: {min_num}-{max_num}, {pad_desc})"
                )

                # 1. Internal Sequence Gaps
                for target in range(min_num + 1, max_num):
                    if target not in known_nums:
                        cand_url = self.build_candidate_url(pat, target)
                        if cand_url not in known_urls and cand_url not in discovered_by_url:
                            info = self.probe_url(http_client, cand_url)
                            if info:
                                info["is_seed"] = False
                                info["sequence_num"] = target
                                info["discovery_type"] = "gap_fill"
                                discovered_by_url[cand_url] = info

                # 2. Forward Boundary Sweep
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
                        info["discovery_type"] = "forward_sweep"
                        discovered_by_url[cand_url] = info
                        consecutive_misses = 0
                    else:
                        consecutive_misses += 1
                        if consecutive_misses >= max_consecutive_misses:
                            break

                # 3. Backward Boundary Sweep
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
                        info["discovery_type"] = "backward_sweep"
                        discovered_by_url[cand_url] = info
                        consecutive_misses = 0
                    else:
                        consecutive_misses += 1
                        if consecutive_misses >= max_consecutive_misses:
                            break

        if client is not None:
            execute_folder_probes(client)
        else:
            with httpx.Client(verify=False, timeout=self.probe_timeout) as default_client:
                execute_folder_probes(default_client)

        verified_siblings = list(discovered_by_url.values())
        verified_siblings.sort(key=lambda s: s.get("sequence_num", 0))

        return {
            "status": "success",
            "strategy": "folder_multi_seed",
            "folder_path": folder_path,
            "domain": domain,
            "total_seed_files": len(urls),
            "patterns_detected": pattern_descriptions,
            "pattern_description": " • ".join(pattern_descriptions),
            "total_verified": len(verified_siblings),
            "siblings": verified_siblings
        }
