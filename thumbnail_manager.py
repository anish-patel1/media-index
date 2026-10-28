"""Thumbnail Manager with LRU Disk Caching.

Proxies, generates, and caches image thumbnails in /static/thumb_cache/
to enable visual previews without CORS errors or unoptimized full-resolution payloads.
"""

import hashlib
import io
import logging
import os
import shutil
import subprocess
import urllib.parse
from typing import Optional, Tuple
import httpx
from PIL import Image

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
THUMB_CACHE_DIR = os.path.join(BASE_DIR, "static", "thumb_cache")
MAX_CACHE_FILES = 500
MAX_CACHE_BYTES = 50 * 1024 * 1024  # 50 MB
DEFAULT_THUMB_SIZE = 150
MAX_THUMB_SIZE = 600
MIN_THUMB_SIZE = 32

ENABLE_VIDEO_THUMBNAILS = os.environ.get("ENABLE_VIDEO_THUMBNAILS", "false").lower() in ("true", "1", "yes")
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"}

# Ensure cache directory exists
os.makedirs(THUMB_CACHE_DIR, exist_ok=True)


def is_ffmpeg_available() -> bool:
    """Checks whether the ffmpeg binary is available in PATH."""
    return shutil.which("ffmpeg") is not None


def extract_video_frame(url: str, timeout: float = 8.0) -> Optional[bytes]:
    """Extracts first frame bytes (PNG format) from video URL using ffmpeg."""
    if not is_ffmpeg_available():
        return None
    try:
        cmd = [
            "ffmpeg",
            "-ss", "00:00:01",
            "-i", url,
            "-vframes", "1",
            "-f", "image2pipe",
            "-vcodec", "png",
            "-"
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
        if res.returncode == 0 and res.stdout:
            return res.stdout
    except Exception as e:
        logger.debug("Failed extracting video frame for %s: %s", url, e)
    return None


def _cache_key(url: str, size: int) -> str:
    """Generates a deterministic hash for URL and target dimension."""
    raw = f"{url.strip()}_{size}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def evict_cache_if_needed(
    cache_dir: str = THUMB_CACHE_DIR,
    max_files: int = MAX_CACHE_FILES,
    max_bytes: int = MAX_CACHE_BYTES,
) -> int:
    """Removes least recently accessed/modified thumbnail files when cache exceeds limits."""
    try:
        entries = []
        total_size = 0
        for entry in os.scandir(cache_dir):
            if entry.is_file() and entry.name.endswith(".webp"):
                stat = entry.stat()
                entries.append((entry.path, stat.st_atime, stat.st_size))
                total_size += stat.st_size

        if len(entries) <= max_files and total_size <= max_bytes:
            return 0

        # Sort by access time ascending (oldest first)
        entries.sort(key=lambda x: x[1])
        evicted = 0

        for path, _, size in entries:
            if len(entries) - evicted <= max_files and total_size <= max_bytes:
                break
            try:
                os.remove(path)
                total_size -= size
                evicted += 1
            except OSError:
                pass

        return evicted
    except Exception as e:
        logger.debug("Thumbnail cache eviction error: %s", e)
        return 0


def get_or_create_thumbnail(
    url: str,
    size: int = DEFAULT_THUMB_SIZE,
    client: Optional[httpx.Client] = None,
) -> Tuple[Optional[str], Optional[str]]:
    """Retrieves cached thumbnail path or fetches source image and generates thumbnail.

    Returns:
        (file_path, error_message)
    """
    clean_url = (url or "").strip()
    if not clean_url:
        return None, "Empty URL provided"

    # Clamp size to safe bounds
    clamped_size = max(MIN_THUMB_SIZE, min(MAX_THUMB_SIZE, size))
    key = _cache_key(clean_url, clamped_size)
    cached_path = os.path.join(THUMB_CACHE_DIR, f"{key}.webp")

    # If cached file exists, touch access time and return
    if os.path.isfile(cached_path):
        try:
            os.utime(cached_path, None)
            return cached_path, None
        except OSError:
            return cached_path, None

    # Check if this is a video asset
    parsed_path = urllib.parse.urlparse(clean_url).path
    ext = os.path.splitext(parsed_path)[1].lower()
    is_video = ext in VIDEO_EXTENSIONS

    image_bytes = None

    if is_video:
        enable_video = os.environ.get("ENABLE_VIDEO_THUMBNAILS", "false").lower() in ("true", "1", "yes")
        if not enable_video:
            return None, "Video thumbnails disabled (set ENABLE_VIDEO_THUMBNAILS=true to enable)"
        if not is_ffmpeg_available():
            return None, "ffmpeg binary not found in system PATH"

        image_bytes = extract_video_frame(clean_url)
        if not image_bytes:
            return None, "Failed extracting video frame via ffmpeg"
    else:
        # Fetch source image
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36 mediaIndexThumb/1.0"
            ),
            "Accept": "image/*,*/*;q=0.8",
        }

        try:
            if client:
                resp = client.get(clean_url, headers=headers, timeout=5.0, follow_redirects=True)
            else:
                with httpx.Client(timeout=5.0, follow_redirects=True) as local_client:
                    resp = local_client.get(clean_url, headers=headers)

            if resp.status_code != 200:
                return None, f"Upstream server returned HTTP {resp.status_code}"

            content_type = resp.headers.get("content-type", "").lower()
            if "text/html" in content_type:
                return None, "Target URL returned HTML rather than media"

            image_bytes = resp.content
            if not image_bytes:
                return None, "Empty response body received"
        except httpx.TimeoutException:
            return None, "Request timed out while fetching image"
        except Exception as e:
            logger.debug("Failed fetching image for %s: %s", clean_url, e)
            return None, f"Image fetch failed: {str(e)}"

    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            # Handle orientation if EXIF present
            try:
                from PIL import ImageOps
                img = ImageOps.exif_transpose(img)
            except Exception:
                pass

            # Convert color space for WebP
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                thumb_img = img.convert("RGBA")
            else:
                thumb_img = img.convert("RGB")

            # Resize maintaining aspect ratio
            thumb_img.thumbnail((clamped_size, clamped_size), Image.Resampling.LANCZOS)

            # Atomic save to disk
            temp_path = f"{cached_path}.tmp"
            thumb_img.save(temp_path, "WEBP", quality=80, method=4)
            os.replace(temp_path, cached_path)

        # Enforce LRU cache limits
        evict_cache_if_needed()

        return cached_path, None

    except httpx.TimeoutException:
        return None, "Request timed out while fetching image"
    except Exception as e:
        logger.debug("Failed creating thumbnail for %s: %s", clean_url, e)
        return None, f"Thumbnail generation failed: {str(e)}"
