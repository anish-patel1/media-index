import os
import unittest
import tempfile
import shutil
from database import URLDatabase


class TestURLDatabase(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory for isolated database testing
        self.test_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.test_dir, "test_urls.json")
        self.db = URLDatabase(self.db_path)

    def tearDown(self):
        shutil.rmtree(self.test_dir)

    def test_parse_valid_url(self):
        parsed = URLDatabase.parse_url("https://cdn.example.com/assets/2026/banners/hero.png?v=2")
        self.assertEqual(parsed["domain"], "cdn.example.com")
        self.assertEqual(parsed["path_segments"], ["assets", "2026", "banners"])
        self.assertEqual(parsed["filename"], "hero.png")
        self.assertEqual(parsed["extension"], "png")

    def test_parse_invalid_url(self):
        with self.assertRaises(ValueError):
            URLDatabase.parse_url("not_a_url")

        with self.assertRaises(ValueError):
            URLDatabase.parse_url("ftp://example.com/file.jpg")

        with self.assertRaises(ValueError):
            URLDatabase.parse_url("")

    def test_add_new_url(self):
        url = "https://images.example.com/nature/forest.jpg"
        result = self.db.add_or_increment_url(url)

        self.assertEqual(result["status"], "success")
        self.assertFalse(result["is_duplicate"])
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["entry"]["filename"], "forest.jpg")

    def test_duplicate_url_increments_count(self):
        url = "https://images.example.com/nature/forest.jpg"
        first = self.db.add_or_increment_url(url)
        self.assertEqual(first["count"], 1)
        self.assertFalse(first["is_duplicate"])

        second = self.db.add_or_increment_url(url)
        self.assertEqual(second["count"], 2)
        self.assertTrue(second["is_duplicate"])

        third = self.db.add_or_increment_url(url)
        self.assertEqual(third["count"], 3)
        self.assertTrue(third["is_duplicate"])

    def test_tree_structure_and_stats(self):
        self.db.add_or_increment_url("https://example.com/photos/2026/img1.jpg")
        self.db.add_or_increment_url("https://example.com/photos/2026/img2.png")
        self.db.add_or_increment_url("https://example.com/photos/2026/img1.jpg")  # duplicate
        self.db.add_or_increment_url("https://other.org/videos/clip.mp4")

        tree_data = self.db.get_tree()
        stats = tree_data["stats"]
        tree = tree_data["tree"]

        # Check statistics
        self.assertEqual(stats["total_urls"], 3)
        self.assertEqual(stats["total_submissions"], 4)
        self.assertEqual(stats["duplicate_submissions"], 1)

        # Check domains in tree
        domain_names = [node["name"] for node in tree]
        self.assertIn("example.com", domain_names)
        self.assertIn("other.org", domain_names)

        # Inspect example.com hierarchy
        ex_node = next(n for n in tree if n["name"] == "example.com")
        self.assertEqual(ex_node["type"], "domain")
        photos_node = ex_node["children"][0]
        self.assertEqual(photos_node["name"], "photos")
        self.assertEqual(photos_node["type"], "folder")

        year_node = photos_node["children"][0]
        self.assertEqual(year_node["name"], "2026")

        files = year_node["children"]
        self.assertEqual(len(files), 2)

        img1 = next(f for f in files if f["name"] == "img1.jpg")
        self.assertEqual(img1["type"], "file")
        self.assertEqual(img1["count"], 2)

        img2 = next(f for f in files if f["name"] == "img2.png")
        self.assertEqual(img2["type"], "file")
        self.assertEqual(img2["count"], 1)

    def test_clear_database(self):
        self.db.add_or_increment_url("https://example.com/file.jpg")
        self.assertEqual(self.db.get_tree()["stats"]["total_urls"], 1)

        res = self.db.clear()
        self.assertEqual(res["status"], "cleared")
        self.assertEqual(self.db.get_tree()["stats"]["total_urls"], 0)

    def test_multi_user_isolation(self):
        user_a = "user_alpha"
        user_b = "user_beta"

        self.db.add_or_increment_url("https://alpha.com/img1.jpg", user_id=user_a)
        self.db.add_or_increment_url("https://alpha.com/img2.jpg", user_id=user_a)
        self.db.add_or_increment_url("https://beta.com/video.mp4", user_id=user_b)

        tree_a = self.db.get_tree(user_id=user_a)
        tree_b = self.db.get_tree(user_id=user_b)

        self.assertEqual(tree_a["stats"]["total_urls"], 2)
        self.assertEqual(tree_b["stats"]["total_urls"], 1)
        self.assertEqual(tree_a["tree"][0]["name"], "alpha.com")
        self.assertEqual(tree_b["tree"][0]["name"], "beta.com")

        # Clearing user A does not affect user B
        self.db.clear(user_id=user_a)
        self.assertEqual(self.db.get_tree(user_id=user_a)["stats"]["total_urls"], 0)
        self.assertEqual(self.db.get_tree(user_id=user_b)["stats"]["total_urls"], 1)

    def test_legacy_format_auto_migration(self):
        # Create a database file with legacy format {"urls": {...}}
        legacy_path = os.path.join(self.test_dir, "legacy.json")
        legacy_data = {
            "urls": {
                "https://legacy.com/pic.jpg": {
                    "url": "https://legacy.com/pic.jpg",
                    "domain": "legacy.com",
                    "path_segments": [],
                    "filename": "pic.jpg",
                    "extension": "jpg",
                    "count": 3,
                    "first_added": "2026-01-01T00:00:00Z",
                    "last_updated": "2026-01-01T00:00:00Z"
                }
            }
        }
        with open(legacy_path, "w", encoding="utf-8") as f:
            import json
            json.dump(legacy_data, f)

        migrated_db = URLDatabase(legacy_path)
        tree = migrated_db.get_tree()
        self.assertEqual(tree["stats"]["total_urls"], 1)
        self.assertEqual(tree["stats"]["total_submissions"], 3)

    def test_export_and_import_data(self):
        user_1 = "user_exp_1"
        user_2 = "user_imp_2"

        self.db.add_or_increment_url("https://site.com/gallery/photo1.jpg", user_id=user_1)
        self.db.add_or_increment_url("https://site.com/gallery/photo1.jpg", user_id=user_1)  # count 2
        self.db.add_or_increment_url("https://site.com/gallery/photo2.png", user_id=user_1)

        # Export user 1 data
        exported = self.db.export_data(user_id=user_1)
        self.assertEqual(exported["version"], "2.0")
        self.assertEqual(exported["total_urls"], 2)

        # Import into user 2
        res = self.db.import_data(exported, user_id=user_2)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["imported"], 2)

        tree_2 = self.db.get_tree(user_id=user_2)
        self.assertEqual(tree_2["stats"]["total_urls"], 2)
        self.assertEqual(tree_2["stats"]["total_submissions"], 3)


if __name__ == "__main__":
    unittest.main()

