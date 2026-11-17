"""
Unit tests for SiblingEngine: zero-404 verification, pattern extraction,
standalone classification, multi-strategy discovery, and consecutive miss bounds.
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
        # A URL with no sequence, date, suffix, or convention pattern
        result = self.engine.discover_siblings("https://mysite.com/static/brandlogo.svg")
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

    def test_directory_index_strategy(self):
        html_content = """
        <!DOCTYPE html>
        <html>
        <head><title>Index of /gallery/</title></head>
        <body>
        <h1>Index of /gallery/</h1>
        <hr>
        <a href="../">../</a>
        <a href="artwork1.png">artwork1.png</a>
        <a href="artwork2.png">artwork2.png</a>
        <a href="artwork3.png">artwork3.png</a>
        <a href="readme.txt">readme.txt</a>
        <hr>
        </body>
        </html>
        """
        def handler(request: httpx.Request):
            url_str = str(request.url)
            if url_str == "https://example.com/gallery/":
                return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, text=html_content)
            if any(f"artwork{i}.png" in url_str for i in (1, 2, 3)):
                return httpx.Response(200, headers={"content-type": "image/png", "content-length": "50000"})
            return httpx.Response(404)

        transport = httpx.MockTransport(handler)
        with httpx.Client(transport=transport) as client:
            seed_url = "https://example.com/gallery/artwork1.png"
            res = self.engine.discover_siblings(seed_url, client=client)
            self.assertEqual(res["status"], "success")
            self.assertEqual(res["strategy"], "directory_index")
            # artwork1 is the seed, so artwork2 and artwork3 should be found
            urls = [s["url"] for s in res["siblings"]]
            self.assertIn("https://example.com/gallery/artwork2.png", urls)
            self.assertIn("https://example.com/gallery/artwork3.png", urls)
            self.assertNotIn("https://example.com/gallery/artwork1.png", urls)

    def test_date_pattern_strategy(self):
        def handler(request: httpx.Request):
            url_str = str(request.url)
            # Adjacent dates: 2024-03-14 and 2024-03-16
            if "daily_2024-03-14.jpg" in url_str or "daily_2024-03-16.jpg" in url_str:
                return httpx.Response(200, headers={"content-type": "image/jpeg", "content-length": "40000"})
            return httpx.Response(404)

        transport = httpx.MockTransport(handler)
        with httpx.Client(transport=transport) as client:
            seed_url = "https://news.example.com/banners/daily_2024-03-15.jpg"
            res = self.engine.discover_siblings(seed_url, client=client)
            self.assertEqual(res["status"], "success")
            self.assertEqual(res["strategy"], "date_pattern")
            self.assertEqual(res["total_verified"], 2)
            urls = [s["url"] for s in res["siblings"]]
            self.assertIn("https://news.example.com/banners/daily_2024-03-14.jpg", urls)
            self.assertIn("https://news.example.com/banners/daily_2024-03-16.jpg", urls)

    def test_quality_suffix_strategy(self):
        def handler(request: httpx.Request):
            url_str = str(request.url)
            if "hero-small.jpg" in url_str or "hero-thumb.jpg" in url_str or "hero.jpg" in url_str:
                return httpx.Response(200, headers={"content-type": "image/jpeg", "content-length": "120000"})
            return httpx.Response(404)

        transport = httpx.MockTransport(handler)
        with httpx.Client(transport=transport) as client:
            seed_url = "https://cdn.site.com/assets/hero-large.jpg"
            res = self.engine.discover_siblings(seed_url, client=client)
            self.assertEqual(res["status"], "success")
            self.assertEqual(res["strategy"], "quality_suffix")
            urls = [s["url"] for s in res["siblings"]]
            self.assertIn("https://cdn.site.com/assets/hero-small.jpg", urls)
            self.assertIn("https://cdn.site.com/assets/hero-thumb.jpg", urls)
            self.assertIn("https://cdn.site.com/assets/hero.jpg", urls)

    def test_convention_variant_retina_and_format(self):
        def handler(request: httpx.Request):
            url_str = str(request.url)
            if "brand-logo@2x.png" in url_str or "brand-logo.webp" in url_str:
                return httpx.Response(200, headers={"content-type": "image/png", "content-length": "60000"})
            return httpx.Response(404)

        transport = httpx.MockTransport(handler)
        with httpx.Client(transport=transport) as client:
            seed_url = "https://static.site.com/img/brand-logo.png"
            res = self.engine.discover_siblings(seed_url, client=client)
            self.assertEqual(res["status"], "success")
            self.assertEqual(res["strategy"], "convention_variant")
            urls = [s["url"] for s in res["siblings"]]
            self.assertIn("https://static.site.com/img/brand-logo@2x.png", urls)
            self.assertIn("https://static.site.com/img/brand-logo.webp", urls)

    def test_alpha_sequence_strategy(self):
        def handler(request: httpx.Request):
            url_str = str(request.url)
            if "chapter_b.png" in url_str or "chapter_c.png" in url_str:
                return httpx.Response(200, headers={"content-type": "image/png", "content-length": "80000"})
            return httpx.Response(404)

        transport = httpx.MockTransport(handler)
        with httpx.Client(transport=transport) as client:
            seed_url = "https://archive.org/book/chapter_a.png"
            res = self.engine.discover_siblings(seed_url, client=client)
            self.assertEqual(res["status"], "success")
            self.assertEqual(res["strategy"], "alpha_sequence")
            urls = [s["url"] for s in res["siblings"]]
            self.assertIn("https://archive.org/book/chapter_b.png", urls)
            self.assertIn("https://archive.org/book/chapter_c.png", urls)


if __name__ == "__main__":
    unittest.main()
