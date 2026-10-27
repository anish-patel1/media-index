"""Metadata Enrichment Engine for Media URLs.

Performs lightweight asynchronous HTTP HEAD / ranged GET requests to extract
Content-Length, Content-Type, Last-Modified, and CDN / server provider headers
without downloading full asset bodies.
"""

import asyncio
import logging
from typing import Dict, List, Optional
from urllib.parse import urlparse
import httpx

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 5.0
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36 mediaIndexEnricher/1.0"
)


def detect_cdn_provider(headers: httpx.Headers) -> Optional[str]:
    """Infers CDN or hosting infrastructure from response headers."""
    header_keys = {k.lower() for k in headers.keys()}

    if "cf-ray" in header_keys or "cf-cache-status" in header_keys:
        return "Cloudflare"
    if "x-amz-cf-id" in header_keys or "x-amz-request-id" in header_keys:
        return "AWS CloudFront / S3"
    if "fastly-debug-digest" in header_keys or "x-fastly-request-id" in header_keys:
        return "Fastly"
    if "x-akamai-transformed" in header_keys or "akamai-grn" in header_keys:
        return "Akamai"
    if "x-cache" in header_keys and "varnish" in headers.get("x-cache", "").lower():
        return "Varnish"
    if "x-goog-generation" in header_keys or "x-guploader-uploadid" in header_keys:
        return "Google Cloud Storage"
    if "x-ms-blob-type" in header_keys or "x-ms-request-id" in header_keys:
        return "Azure Blob Storage"

    server = headers.get("server", "").strip()
    if server:
        # Avoid leaking overly detailed internal version strings
        return server.split("/")[0]

    via = headers.get("via", "").strip()
    if via:
        return via.split()[0]

    return None


def clean_mime_type(content_type_header: Optional[str]) -> Optional[str]:
    """Extracts base MIME type (e.g. 'image/png') stripped of charset or parameters."""
    if not content_type_header:
        return None
    raw = content_type_header.split(";")[0].strip().lower()
    return raw if "/" in raw else None


def parse_image_dimensions(chunk: bytes) -> Optional[List[int]]:
    """Extracts [width, height] from initial header bytes of an image file."""
    if not chunk:
        return None

    # Check for SVG format (text-based XML)
    if b"<svg" in chunk.lower():
        try:
            import re
            chunk_str = chunk.decode("utf-8", errors="ignore")
            w_match = re.search(r'width=["\']([\d.]+)(?:px)?["\']', chunk_str, re.IGNORECASE)
            h_match = re.search(r'height=["\']([\d.]+)(?:px)?["\']', chunk_str, re.IGNORECASE)
            if w_match and h_match:
                return [int(round(float(w_match.group(1)))), int(round(float(h_match.group(1))))]
            viewbox_match = re.search(
                r'viewBox=["\'][\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)["\']', chunk_str, re.IGNORECASE
            )
            if viewbox_match:
                return [int(round(float(viewbox_match.group(1)))), int(round(float(viewbox_match.group(2))))]
        except Exception:
            pass

    # Standard raster formats using Pillow's streaming ImageFile.Parser
    try:
        from PIL import ImageFile
        parser = ImageFile.Parser()
        parser.feed(chunk)
        if parser.image:
            w, h = parser.image.size
            return [int(w), int(h)]
    except Exception as e:
        logger.debug("Pillow dimension parse failed: %s", e)

    return None



class MetadataEnricher:
    """Extracts HTTP metadata from target URLs asynchronously."""

    def __init__(
        self,
        client: Optional[httpx.AsyncClient] = None,
        max_concurrency: int = 10,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        self._external_client = client is not None
        self.timeout = timeout
        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.client = client or httpx.AsyncClient(
            http2=True,
            timeout=httpx.Timeout(timeout),
            follow_redirects=True,
            headers={"User-Agent": DEFAULT_USER_AGENT},
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    async def close(self):
        """Closes internal HTTP client if owned by this instance."""
        if not self._external_client and not self.client.is_closed:
            await self.client.aclose()

    async def enrich_url(self, url: str, extract_dimensions: bool = True) -> dict:
        """Issues an async HEAD (or fallback ranged GET) request to extract metadata."""
        clean_url = url.strip()
        parsed = urlparse(clean_url)
        if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc:
            return {"url": clean_url, "error": "Invalid URL protocol"}

        async with self.semaphore:
            try:
                resp = await self.client.head(clean_url)

                # Fallback to ranged GET if HEAD is rejected with 405 Method Not Allowed
                if resp.status_code == 405:
                    resp = await self.client.get(
                        clean_url,
                        headers={"Range": "bytes=0-0"},
                    )

                content_len_hdr = resp.headers.get("content-length")
                size_bytes = None
                if content_len_hdr and content_len_hdr.isdigit():
                    size_bytes = int(content_len_hdr)
                elif resp.status_code == 206:
                    # Parse Content-Range: bytes 0-0/12345
                    cr = resp.headers.get("content-range", "")
                    if "/" in cr:
                        total_part = cr.split("/")[-1].strip()
                        if total_part.isdigit():
                            size_bytes = int(total_part)

                mime_type = clean_mime_type(resp.headers.get("content-type"))
                last_modified = resp.headers.get("last-modified")
                cdn_provider = detect_cdn_provider(resp.headers)
                etag = resp.headers.get("etag")

                dimensions = None
                # Check if asset represents an image
                is_image = False
                if mime_type and mime_type.startswith("image/"):
                    is_image = True
                else:
                    import os
                    from urllib.parse import unquote
                    clean_path = unquote(parsed.path).lower()
                    _, ext = os.path.splitext(clean_path)
                    if ext.lstrip(".") in {"jpg", "jpeg", "png", "webp", "gif", "bmp", "ico", "svg", "avif"}:
                        is_image = True

                if extract_dimensions and is_image and resp.status_code in (200, 206):
                    try:
                        dim_resp = await self.client.get(
                            clean_url,
                            headers={"Range": "bytes=0-2047"},
                        )
                        if dim_resp.status_code in (200, 206) and dim_resp.content:
                            dimensions = parse_image_dimensions(dim_resp.content)
                    except Exception as dim_err:
                        logger.debug("Dimension parse fetch failed for %s: %s", clean_url, dim_err)

                return {
                    "url": clean_url,
                    "final_url": str(resp.url),
                    "status_code": resp.status_code,
                    "size_bytes": size_bytes,
                    "mime_type": mime_type,
                    "dimensions": dimensions,
                    "last_modified": last_modified,
                    "cdn_provider": cdn_provider,
                    "etag": etag.strip('"') if etag else None,
                }
            except httpx.TimeoutException:
                logger.debug("Enrichment timeout for %s", clean_url)
                return {"url": clean_url, "error": "Request timed out"}
            except Exception as e:
                logger.debug("Enrichment failed for %s: %s", clean_url, e)
                return {"url": clean_url, "error": str(e)}

    async def enrich_batch(self, urls: List[str]) -> List[dict]:
        """Concurrently enriches a collection of URLs."""
        if not urls:
            return []
        tasks = [self.enrich_url(u) for u in urls]
        return await asyncio.gather(*tasks, return_exceptions=False)

    @staticmethod
    def enrich_url_sync(url: str, timeout: float = DEFAULT_TIMEOUT) -> dict:
        """Convenience synchronous wrapper around enrich_url."""
        async def _run():
            async with MetadataEnricher(timeout=timeout) as enricher:
                return await enricher.enrich_url(url)

        return asyncio.run(_run())
