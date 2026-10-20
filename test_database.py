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


if __name__ == "__main__":
    unittest.main()
