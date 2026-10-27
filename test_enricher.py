import asyncio
import unittest
import httpx
from enricher import MetadataEnricher, clean_mime_type, detect_cdn_provider


class TestEnricherHelpers(unittest.TestCase):
    def test_clean_mime_type(self):
        self.assertEqual(clean_mime_type("image/png; charset=utf-8"), "image/png")
        self.assertEqual(clean_mime_type("VIDEO/MP4"), "video/mp4")
        self.assertEqual(clean_mime_type("application/json"), "application/json")
        self.assertIsNone(clean_mime_type("invalid-mime"))
        self.assertIsNone(clean_mime_type(None))

    def test_detect_cdn_provider(self):
        # Cloudflare
        h_cf = httpx.Headers({"cf-ray": "123456789", "server": "cloudflare"})
        self.assertEqual(detect_cdn_provider(h_cf), "Cloudflare")

        # AWS CloudFront
        h_aws = httpx.Headers({"x-amz-cf-id": "abcdef==", "server": "AmazonS3"})
        self.assertEqual(detect_cdn_provider(h_aws), "AWS CloudFront / S3")

        # Fastly
        h_fastly = httpx.Headers({"fastly-debug-digest": "xyz", "server": "Varnish"})
        self.assertEqual(detect_cdn_provider(h_fastly), "Fastly")

        # Google Cloud Storage
        h_gcs = httpx.Headers({"x-goog-generation": "987654", "server": "UploadServer"})
        self.assertEqual(detect_cdn_provider(h_gcs), "Google Cloud Storage")

        # Fallback to server header
        h_nginx = httpx.Headers({"server": "nginx/1.24.0"})
        self.assertEqual(detect_cdn_provider(h_nginx), "nginx")

        # Empty fallback
        h_empty = httpx.Headers({})
        self.assertIsNone(detect_cdn_provider(h_empty))

    def test_parse_image_dimensions(self):
        import io
        from PIL import Image
        from enricher import parse_image_dimensions

        # PNG dimensions
        img_png = Image.new("RGB", (1280, 720), color="green")
        buf_png = io.BytesIO()
        img_png.save(buf_png, format="PNG")
        self.assertEqual(parse_image_dimensions(buf_png.getvalue()[:256]), [1280, 720])

        # JPEG dimensions
        img_jpg = Image.new("RGB", (640, 480), color="blue")
        buf_jpg = io.BytesIO()
        img_jpg.save(buf_jpg, format="JPEG")
        self.assertEqual(parse_image_dimensions(buf_jpg.getvalue()[:1024]), [640, 480])

        # SVG dimensions
        svg_bytes = b'<svg width="500px" height="350px" xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
        self.assertEqual(parse_image_dimensions(svg_bytes), [500, 350])

        # Invalid or empty
        self.assertIsNone(parse_image_dimensions(b"not an image file"))
        self.assertIsNone(parse_image_dimensions(b""))


class TestMetadataEnricher(unittest.IsolatedAsyncioTestCase):

    async def test_enrich_url_with_dimensions(self):
        import io
        from PIL import Image
        img = Image.new("RGB", (1920, 1080), color="red")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_bytes = buf.getvalue()

        def handler(request: httpx.Request):
            if request.method == "HEAD":
                return httpx.Response(
                    200,
                    headers={
                        "content-length": str(len(png_bytes)),
                        "content-type": "image/png",
                    },
                )
            if request.method == "GET" and "bytes=0-2047" in request.headers.get("range", ""):
                return httpx.Response(206, content=png_bytes[:2048])
            return httpx.Response(400)

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            enricher = MetadataEnricher(client=client)
            data = await enricher.enrich_url("https://example.com/photo.png", extract_dimensions=True)
            self.assertEqual(data["mime_type"], "image/png")
            self.assertEqual(data["dimensions"], [1920, 1080])

    async def test_enrich_url_success(self):
        def handler(request: httpx.Request):
            if request.method == "HEAD":
                return httpx.Response(
                    200,
                    headers={
                        "content-length": "204800",
                        "content-type": "image/webp",
                        "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT",
                        "cf-ray": "8a1b2c3d4e5f",
                        "etag": '"abc123xyz"',
                    },
                )
            return httpx.Response(400)

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            enricher = MetadataEnricher(client=client)
            data = await enricher.enrich_url("https://example.com/assets/banner.webp")

            self.assertEqual(data["status_code"], 200)
            self.assertEqual(data["size_bytes"], 204800)
            self.assertEqual(data["mime_type"], "image/webp")
            self.assertEqual(data["last_modified"], "Wed, 21 Oct 2026 07:28:00 GMT")
            self.assertEqual(data["cdn_provider"], "Cloudflare")
            self.assertEqual(data["etag"], "abc123xyz")

    async def test_enrich_url_fallback_ranged_get(self):
        def handler(request: httpx.Request):
            if request.method == "HEAD":
                return httpx.Response(405)  # Method Not Allowed
            if request.method == "GET":
                self.assertEqual(request.headers.get("range"), "bytes=0-0")
                return httpx.Response(
                    206,
                    headers={
                        "content-range": "bytes 0-0/543210",
                        "content-type": "video/mp4",
                        "server": "cloudflare",
                    },
                )
            return httpx.Response(400)

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            enricher = MetadataEnricher(client=client)
            data = await enricher.enrich_url("https://example.com/stream/clip.mp4")

            self.assertEqual(data["status_code"], 206)
            self.assertEqual(data["size_bytes"], 543210)
            self.assertEqual(data["mime_type"], "video/mp4")

    async def test_enrich_invalid_protocol(self):
        enricher = MetadataEnricher()
        try:
            data = await enricher.enrich_url("ftp://example.com/file.jpg")
            self.assertIn("error", data)
        finally:
            await enricher.close()

    async def test_enrich_batch(self):
        def handler(request: httpx.Request):
            return httpx.Response(
                200,
                headers={"content-length": "1024", "content-type": "image/png"},
            )

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            enricher = MetadataEnricher(client=client)
            urls = [
                "https://example.com/1.png",
                "https://example.com/2.png",
                "https://example.com/3.png",
            ]
            results = await enricher.enrich_batch(urls)
            self.assertEqual(len(results), 3)
            for res in results:
                self.assertEqual(res["size_bytes"], 1024)
                self.assertEqual(res["mime_type"], "image/png")


if __name__ == "__main__":
    unittest.main()
