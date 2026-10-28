"""
Unit tests for ClusterEngine (Phase 4: Smart Duplicate Clustering).
"""
import unittest
from cluster_engine import ClusterEngine


class TestClusterEngine(unittest.TestCase):
    def setUp(self):
        self.engine = ClusterEngine()

    def test_empty_or_single_item(self):
        self.assertEqual(self.engine.find_clusters([]), [])
        self.assertEqual(self.engine.find_clusters([{"url": "https://example.com/one.jpg"}]), [])

    def test_exact_filename_and_size_clustering(self):
        entries = [
            {
                "url": "https://cdn1.example.org/assets/hero_banner.jpg",
                "domain": "cdn1.example.org",
                "filename": "hero_banner.jpg",
                "count": 1,
                "metadata": {
                    "content_length": 254000,
                    "content_type": "image/jpeg",
                    "width": 1920,
                    "height": 1080
                }
            },
            {
                "url": "https://cdn2.example.org/mirrors/hero_banner.jpg?utm_source=newsletter",
                "domain": "cdn2.example.org",
                "filename": "hero_banner.jpg",
                "count": 1,
                "metadata": {
                    "content_length": 254000,
                    "content_type": "image/jpeg",
                    "width": 1920,
                    "height": 1080
                }
            },
            {
                "url": "https://unrelated.com/other.png",
                "domain": "unrelated.com",
                "filename": "other.png",
                "count": 1,
                "metadata": {
                    "content_length": 12000,
                    "content_type": "image/png"
                }
            }
        ]

        clusters = self.engine.find_clusters(entries)
        self.assertEqual(len(clusters), 1)

        clus = clusters[0]
        self.assertEqual(clus["confidence"], "high")
        self.assertEqual(clus["match_rule"], "filename_and_size")
        self.assertEqual(clus["duplicate_count"], 1)
        self.assertEqual(clus["savings_bytes"], 254000)
        # Canonical should be the clean URL without utm_source query parameter
        self.assertEqual(clus["canonical_url"], "https://cdn1.example.org/assets/hero_banner.jpg")
        self.assertEqual(len(clus["items"]), 2)
        self.assertTrue(clus["items"][0]["is_canonical"])
        self.assertFalse(clus["items"][1]["is_canonical"])

    def test_canonical_selection_heuristics(self):
        # Tracking param vs clean URL
        item_dirty = {
            "url": "https://example.com/pic.jpg?utm_medium=social&fbclid=XYZ123",
            "filename": "pic.jpg",
            "metadata": {"content_length": 50000}
        }
        item_clean = {
            "url": "https://example.com/pic.jpg",
            "filename": "pic.jpg",
            "metadata": {"content_length": 50000}
        }
        score_dirty = self.engine._score_for_canonical(item_dirty)
        score_clean = self.engine._score_for_canonical(item_clean)
        self.assertGreater(score_clean, score_dirty)

        # HTTPS vs HTTP
        item_http = {
            "url": "http://example.com/pic.jpg",
            "filename": "pic.jpg",
            "metadata": {"content_length": 50000}
        }
        self.assertGreater(score_clean, self.engine._score_for_canonical(item_http))

    def test_no_false_positives(self):
        # Same filename, different sizes -> No cluster
        entries = [
            {
                "url": "https://cdn.example.org/logo.png",
                "filename": "logo.png",
                "metadata": {"content_length": 1000}
            },
            {
                "url": "https://other.example.org/logo.png",
                "filename": "logo.png",
                "metadata": {"content_length": 5000}
            }
        ]
        self.assertEqual(self.engine.find_clusters(entries), [])

        # Same size, different filenames -> No cluster under Step 4.1 rule
        entries2 = [
            {
                "url": "https://cdn.example.org/icon.png",
                "filename": "icon.png",
                "metadata": {"content_length": 1000}
            },
            {
                "url": "https://other.example.org/avatar.png",
                "filename": "avatar.png",
                "metadata": {"content_length": 1000}
            }
        ]
        self.assertEqual(self.engine.find_clusters(entries2), [])

        # Missing or 0 content_length -> No cluster
        entries3 = [
            {
                "url": "https://cdn.example.org/sample.jpg",
                "filename": "sample.jpg",
                "metadata": {"content_length": 0}
            },
            {
                "url": "https://other.example.org/sample.jpg",
                "filename": "sample.jpg",
                "metadata": {}
            }
        ]
        self.assertEqual(self.engine.find_clusters(entries3), [])

    def test_dict_input_support(self):
        dict_entries = {
            "https://site.com/a/file.mp4": {
                "url": "https://site.com/a/file.mp4",
                "filename": "file.mp4",
                "metadata": {"content_length": 10485760}
            },
            "https://mirror.org/b/file.mp4": {
                "url": "https://mirror.org/b/file.mp4",
                "filename": "file.mp4",
                "metadata": {"content_length": 10485760}
            }
        }
        clusters = self.engine.find_clusters(dict_entries)
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0]["duplicate_count"], 1)

    def test_path_segment_pattern_clustering(self):
        entries = [
            {
                "url": "https://plus.unsplash.com/premium_photo-1683910767532-3a25b821f7ae?w=600",
                "domain": "plus.unsplash.com",
                "filename": "premium_photo-1683910767532-3a25b821f7ae",
                "metadata": {}
            },
            {
                "url": "https://images.unsplash.com/photo-1683910767532-3a25b821f7ae?w=1080",
                "domain": "images.unsplash.com",
                "filename": "photo-1683910767532-3a25b821f7ae",
                "metadata": {}
            }
        ]

        clusters = self.engine.find_clusters(entries)
        self.assertEqual(len(clusters), 1)
        clus = clusters[0]
        self.assertEqual(clus["confidence"], "medium")
        self.assertEqual(clus["match_rule"], "path_segment_pattern")
        self.assertEqual(clus["duplicate_count"], 1)
        # Canonical should prefer w=1080 over w=600
        self.assertEqual(clus["canonical_url"], "https://images.unsplash.com/photo-1683910767532-3a25b821f7ae?w=1080")

    def test_cdn_mirror_subdomain_normalization(self):
        entries = [
            {
                "url": "https://cdn1.site.com/media/2026/video.mp4?sig=123",
                "domain": "cdn1.site.com",
                "filename": "video.mp4",
                "metadata": {"content_length": 5000000}
            },
            {
                "url": "https://cdn2.site.com/media/2026/video.mp4",
                "domain": "cdn2.site.com",
                "filename": "video.mp4",
                "metadata": {}  # Missing size, so rule 1 (high) won't trigger
            }
        ]

        clusters = self.engine.find_clusters(entries)
        self.assertEqual(len(clusters), 1)
        clus = clusters[0]
        self.assertEqual(clus["confidence"], "medium")
        self.assertEqual(clus["match_rule"], "path_segment_pattern")
        # Clean URL on cdn2 should be preferred as canonical over sig=123 on cdn1
        self.assertEqual(clus["canonical_url"], "https://cdn2.site.com/media/2026/video.mp4")

    def test_priority_high_over_medium(self):
        # Two identical size+filename items should match HIGH confidence and NOT produce a duplicate MEDIUM cluster
        entries = [
            {
                "url": "https://cdn1.example.com/asset.png",
                "domain": "cdn1.example.com",
                "filename": "asset.png",
                "metadata": {"content_length": 500}
            },
            {
                "url": "https://cdn2.example.com/asset.png",
                "domain": "cdn2.example.com",
                "filename": "asset.png",
                "metadata": {"content_length": 500}
            }
        ]
        clusters = self.engine.find_clusters(entries)
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0]["confidence"], "high")

    def test_compute_image_hash_and_hamming_distance(self):
        from PIL import Image
        # Create identical 32x32 image
        img1 = Image.new("RGB", (32, 32), color=(200, 100, 50))
        img2 = Image.new("RGB", (32, 32), color=(202, 100, 50))  # Imperceptible difference
        img3 = Image.new("RGB", (32, 32), color=(0, 0, 0))

        h1 = self.engine.compute_image_hash(img1)
        h2 = self.engine.compute_image_hash(img2)
        h3 = self.engine.compute_image_hash(img3)

        self.assertIsNotNone(h1)
        self.assertIsNotNone(h2)
        self.assertIsNotNone(h3)

        # Distance between near-identical images should be 0 or small (<= 4)
        dist_1_2 = self.engine.hamming_distance(h1, h2)
        self.assertLessEqual(dist_1_2, 4)

    def test_perceptual_hash_clustering(self):
        # Two files with completely different names and domains, but matching dHash
        # Example 16-hex perceptual hashes with distance <= 4
        hash_base = "d4e28a9b7c3f1025"
        hash_variant = "d4e28a9b7c3f1024"  # 1 bit difference

        entries = [
            {
                "url": "https://img.host-a.com/original_render.png",
                "domain": "img.host-a.com",
                "filename": "original_render.png",
                "metadata": {
                    "phash": hash_base,
                    "content_length": 950000,
                    "width": 1920,
                    "height": 1080
                }
            },
            {
                "url": "https://cdn.host-b.org/optimized_thumb.webp",
                "domain": "cdn.host-b.org",
                "filename": "optimized_thumb.webp",
                "metadata": {
                    "phash": hash_variant,
                    "content_length": 85000,
                    "width": 640,
                    "height": 360
                }
            },
            {
                "url": "https://unrelated.com/cat.jpg",
                "domain": "unrelated.com",
                "filename": "cat.jpg",
                "metadata": {
                    "phash": "ffffffff00000000",
                    "content_length": 12000
                }
            }
        ]

        clusters = self.engine.find_clusters(entries)
        self.assertEqual(len(clusters), 1)

        clus = clusters[0]
        self.assertEqual(clus["confidence"], "high")
        self.assertEqual(clus["match_rule"], "perceptual_hash")
        self.assertEqual(clus["duplicate_count"], 1)
        # Canonical should pick the 1920x1080 original over the 640x360 thumb
        self.assertEqual(clus["canonical_url"], "https://img.host-a.com/original_render.png")
        self.assertEqual(clus["savings_bytes"], 85000)


if __name__ == "__main__":
    unittest.main()
