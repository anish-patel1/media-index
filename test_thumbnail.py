import io
import os
import tempfile
import unittest
from unittest.mock import patch
import httpx
from PIL import Image

import thumbnail_manager
from thumbnail_manager import (
    _cache_key,
    evict_cache_if_needed,
    get_or_create_thumbnail,
)
from app import app


class TestThumbnailManager(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.orig_cache_dir = thumbnail_manager.THUMB_CACHE_DIR
        thumbnail_manager.THUMB_CACHE_DIR = self.test_dir

    def tearDown(self):
        thumbnail_manager.THUMB_CACHE_DIR = self.orig_cache_dir
        import shutil
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_cache_key(self):
        k1 = _cache_key("https://example.com/photo.jpg", 150)
        k2 = _cache_key("https://example.com/photo.jpg", 150)
        k3 = _cache_key("https://example.com/photo.jpg", 300)
        self.assertEqual(k1, k2)
        self.assertNotEqual(k1, k3)

    def test_get_or_create_thumbnail_success(self):
        # Create dummy image in memory
        img = Image.new("RGB", (800, 600), color="blue")
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        jpg_bytes = buf.getvalue()

        def handler(request: httpx.Request):
            return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=jpg_bytes)

        client = httpx.Client(transport=httpx.MockTransport(handler))
        path, err = get_or_create_thumbnail("https://example.com/nature.jpg", size=150, client=client)

        self.assertIsNone(err)
        self.assertIsNotNone(path)
        self.assertTrue(os.path.isfile(path))

        # Verify cached image format and bounds
        with Image.open(path) as thumb:
            self.assertEqual(thumb.format, "WEBP")
            self.assertLessEqual(max(thumb.size), 150)

        # Second retrieval should use cache without invoking network
        path2, err2 = get_or_create_thumbnail("https://example.com/nature.jpg", size=150, client=None)
        self.assertEqual(path, path2)
        self.assertIsNone(err2)

    def test_get_or_create_thumbnail_html_error(self):
        def handler(request: httpx.Request):
            return httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html>404</html>")

        client = httpx.Client(transport=httpx.MockTransport(handler))
        path, err = get_or_create_thumbnail("https://example.com/page", size=150, client=client)
        self.assertIsNone(path)
        self.assertIn("HTML", err)

    def test_evict_cache_if_needed(self):
        # Create 5 dummy webp files
        for i in range(5):
            p = os.path.join(self.test_dir, f"thumb_{i}.webp")
            with open(p, "wb") as f:
                f.write(b"dummy_webp_content_padding" * 10)

        evicted = evict_cache_if_needed(cache_dir=self.test_dir, max_files=2, max_bytes=100000)
        self.assertEqual(evicted, 3)
        remaining = [f for f in os.listdir(self.test_dir) if f.endswith(".webp")]
        self.assertEqual(len(remaining), 2)

    def test_video_thumbnail_disabled_by_default(self):
        with patch.dict(os.environ, {"ENABLE_VIDEO_THUMBNAILS": "false"}):
            path, err = get_or_create_thumbnail("https://example.com/clip.mp4", size=150)
            self.assertIsNone(path)
            self.assertIn("disabled", err)

    def test_video_thumbnail_missing_ffmpeg(self):
        with patch.dict(os.environ, {"ENABLE_VIDEO_THUMBNAILS": "true"}):
            with patch("thumbnail_manager.is_ffmpeg_available", return_value=False):
                path, err = get_or_create_thumbnail("https://example.com/clip.mp4", size=150)
                self.assertIsNone(path)
                self.assertIn("ffmpeg", err)

    def test_video_thumbnail_success(self):
        # Create a mock video frame in memory
        frame_img = Image.new("RGB", (640, 360), color="green")
        buf = io.BytesIO()
        frame_img.save(buf, format="PNG")
        mock_png_bytes = buf.getvalue()

        with patch.dict(os.environ, {"ENABLE_VIDEO_THUMBNAILS": "true"}):
            with patch("thumbnail_manager.is_ffmpeg_available", return_value=True):
                with patch("thumbnail_manager.extract_video_frame", return_value=mock_png_bytes):
                    path, err = get_or_create_thumbnail("https://example.com/movie.mp4", size=150)
                    self.assertIsNone(err)
                    self.assertIsNotNone(path)
                    self.assertTrue(os.path.isfile(path))
                    with Image.open(path) as thumb:
                        self.assertEqual(thumb.format, "WEBP")


class TestThumbnailRoute(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_thumbnail_missing_param(self):
        res = self.client.get("/api/thumbnail")
        self.assertEqual(res.status_code, 400)

    def test_thumbnail_endpoint_success(self):
        with tempfile.NamedTemporaryFile(suffix=".webp", delete=False) as f:
            f.write(b"RIFF....WEBPVP8 ...")
            temp_path = f.name

        try:
            with patch("app.get_or_create_thumbnail") as mock_thumb:
                mock_thumb.return_value = (temp_path, None)
                res = self.client.get("/api/thumbnail?url=https://example.com/img.png&size=120")
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.mimetype, "image/webp")
                res.close()
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    def test_thumbnail_endpoint_not_found(self):
        with patch("app.get_or_create_thumbnail") as mock_thumb:
            mock_thumb.return_value = (None, "Upstream error 404")
            res = self.client.get("/api/thumbnail?url=https://example.com/broken.png")
            self.assertEqual(res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
