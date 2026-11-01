"""
Unit tests for SiblingEngine: zero-404 verification, pattern extraction,
standalone classification, and consecutive miss bounds.
"""

import unittest
import httpx
from sibling_engine import SiblingEngine


class TestSiblingEngine(unittest.TestCase):
    def setUp(self):
        self.engine = SiblingEngine(probe_timeout=1.0, max_workers=3)

    def test_standalone_detection(self):
        self.assertTrue(SiblingEngine.is_standalone_asset("https://i.redd.it/9n4k124.jpg")[0])
        self.assertTrue(SiblingEngine.is_standalone_asset("https://pbs.twimg.com/media/Fg789.png")[0])
        self.assertTrue(SiblingEngine.is_standalone_asset("https://cdn.discordapp.com/attachments/1/2/photo.png")[0])
        self.assertTrue(SiblingEngine.is_standalone_asset("https://i.imgur.com/abcd123.jpg")[0])

        self.assertFalse(SiblingEngine.is_standalone_asset("https://cdn.mysite.com/assets/banner_01.jpg")[0])
        self.assertFalse(SiblingEngine.is_standalone_asset("https://example.com/gallery/DSC_0042.jpg")[0])

    def test_pattern_extraction_padded(self):
        url = "https://cdn.example.com/wallpapers/wp_005.jpg"
        pattern = SiblingEngine.extract_sequence_pattern(url)

        self.assertIsNotNone(pattern)
        self.assertEqual(pattern["seed_num"], 5)
        self.assertEqual(pattern["pad_len"], 3)
        self.assertEqual(pattern["prefix"], "wp_")
        self.assertEqual(pattern["ext"], ".jpg")
        self.assertEqual(pattern["suffix"], "")

        cand = SiblingEngine.build_candidate_url(pattern, 6)
        self.assertEqual(cand, "https://cdn.example.com/wallpapers/wp_006.jpg")

    def test_pattern_extraction_with_suffix(self):
        url = "https://example.com/assets/img_12_thumb.png?v=2"
        pattern = SiblingEngine.extract_sequence_pattern(url)

        self.assertIsNotNone(pattern)
        self.assertEqual(pattern["seed_num"], 12)
        self.assertEqual(pattern["suffix"], "_thumb")
        self.assertEqual(pattern["prefix"], "img_")

        cand = SiblingEngine.build_candidate_url(pattern, 13)
        self.assertEqual(cand, "https://example.com/assets/img_13_thumb.png?v=2")

    def test_pattern_extraction_no_sequence(self):
        url = "https://example.com/brand/logo.svg"
        pattern = SiblingEngine.extract_sequence_pattern(url)
        self.assertIsNone(pattern)

    def test_standalone_discovery_shortcut(self):
        result = self.engine.discover_siblings("https://i.redd.it/xyz999.png")
        self.assertEqual(result["status"], "standalone")
        self.assertEqual(result["total_verified"], 0)
        self.assertEqual(len(result["siblings"]), 0)

    def test_no_pattern_discovery_shortcut(self):
        result = self.engine.discover_siblings("https://mysite.com/static/icon.png")
        self.assertEqual(result["status"], "no_pattern")
        self.assertEqual(result["total_verified"], 0)

    def test_verified_siblings_probes(self):
        def handler(request: httpx.Request):
            url_str = str(request.url)
            if "img_01.jpg" in url_str or "img_03.jpg" in url_str or "img_04.jpg" in url_str:
                return httpx.Response(
                    200,
                    headers={
                        "content-type": "image/jpeg",
                        "content-length": "102400",
                        "last-modified": "Sat, 01 Nov 2026 12:00:00 GMT"
                    }
                )
            return httpx.Response(404)

        transport = httpx.MockTransport(handler)
        with httpx.Client(transport=transport) as client:
            url = "https://example.com/gallery/img_02.jpg"
            result = self.engine.discover_siblings(url, client=client)

            self.assertEqual(result["status"], "success")
            self.assertEqual(result["strategy"], "numeric_sequence")
            self.assertEqual(result["total_verified"], 3)  # img_01, img_03, img_04

            verified_urls = [s["url"] for s in result["siblings"]]
            self.assertEqual(verified_urls, [
                "https://example.com/gallery/img_01.jpg",
                "https://example.com/gallery/img_03.jpg",
                "https://example.com/gallery/img_04.jpg"
            ])

    def test_folder_discovery_gap_and_bounds(self):
        def handler(request: httpx.Request):
            url_str = str(request.url)
            # Server hosts img_01 through img_05
            if any(f"img_0{i}.jpg" in url_str for i in (1, 2, 3, 4, 5)):
                return httpx.Response(
                    200,
                    headers={
                        "content-type": "image/jpeg",
                        "content-length": "204800"
                    }
                )
            return httpx.Response(404)

        transport = httpx.MockTransport(handler)
        with httpx.Client(transport=transport) as client:
            # Existing URLs in library folder are img_01 and img_04 (gap is 02, 03; forward is 05)
            folder_urls = [
                "https://example.com/gallery/img_01.jpg",
                "https://example.com/gallery/img_04.jpg"
            ]
            res = self.engine.discover_folder_siblings(
                folder_path="/gallery/",
                domain="example.com",
                urls=folder_urls,
                client=client
            )

            self.assertEqual(res["status"], "success")
            self.assertEqual(res["strategy"], "folder_multi_seed")
            self.assertEqual(res["total_verified"], 3)  # 02, 03 (gaps), 05 (forward sweep)
            discovered_urls = [s["url"] for s in res["siblings"]]
            self.assertIn("https://example.com/gallery/img_02.jpg", discovered_urls)
            self.assertIn("https://example.com/gallery/img_03.jpg", discovered_urls)
            self.assertIn("https://example.com/gallery/img_05.jpg", discovered_urls)
            # Ensure existing seed URLs (img_01, img_04) were NOT re-added as new siblings
            self.assertNotIn("https://example.com/gallery/img_01.jpg", discovered_urls)
            self.assertNotIn("https://example.com/gallery/img_04.jpg", discovered_urls)


if __name__ == "__main__":
    unittest.main()
