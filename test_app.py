import os
import unittest
import tempfile
import shutil
import json

# Set test database path before importing app
temp_dir = tempfile.mkdtemp()
test_db_path = os.path.join(temp_dir, "test_app_urls.json")
os.environ["URL_DB_PATH"] = test_db_path

from app import app, db


class TestAppRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.config["TESTING"] = True
        cls.client = app.test_client()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(temp_dir, ignore_errors=True)

    def setUp(self):
        # Reset database before each test
        db.clear()

    def test_get_index(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)

    def test_add_valid_new_url(self):
        payload = {"url": "https://assets.example.com/2026/summer/banner.png"}
        response = self.client.post("/api/urls", json=payload)
        self.assertEqual(response.status_code, 201)

        data = response.get_json()
        self.assertEqual(data["status"], "success")
        self.assertFalse(data["is_duplicate"])
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["entry"]["filename"], "banner.png")

    def test_add_duplicate_url(self):
        payload = {"url": "https://assets.example.com/2026/summer/banner.png"}
        # First submission
        self.client.post("/api/urls", json=payload)
        # Second submission
        response = self.client.post("/api/urls", json=payload)
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        self.assertEqual(data["status"], "success")
        self.assertTrue(data["is_duplicate"])
        self.assertEqual(data["count"], 2)

    def test_add_invalid_url_and_payload(self):
        # Missing JSON body
        res1 = self.client.post("/api/urls", data="invalid", content_type="text/plain")
        self.assertEqual(res1.status_code, 400)

        # Missing 'url' key
        res2 = self.client.post("/api/urls", json={"wrong_key": "val"})
        self.assertEqual(res2.status_code, 400)

        # Empty string
        res3 = self.client.post("/api/urls", json={"url": "   "})
        self.assertEqual(res3.status_code, 400)

        # Invalid URL scheme
        res4 = self.client.post("/api/urls", json={"url": "ftp://example.com/file.jpg"})
        self.assertEqual(res4.status_code, 400)

    def test_get_tree_endpoint(self):
        self.client.post("/api/urls", json={"url": "https://img.domain.com/cat.jpg"})
        self.client.post("/api/urls", json={"url": "https://img.domain.com/cat.jpg"})

        response = self.client.get("/api/tree")
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["stats"]["total_urls"], 1)
        self.assertEqual(data["stats"]["total_submissions"], 2)
        self.assertEqual(data["stats"]["duplicate_submissions"], 1)
        self.assertEqual(len(data["tree"]), 1)
        self.assertEqual(data["tree"][0]["name"], "img.domain.com")

    def test_clear_database_endpoint(self):
        self.client.post("/api/urls", json={"url": "https://img.domain.com/cat.jpg"})
        clear_res = self.client.post("/api/clear")
        self.assertEqual(clear_res.status_code, 200)

        tree_res = self.client.get("/api/tree")
        self.assertEqual(tree_res.get_json()["stats"]["total_urls"], 0)


if __name__ == "__main__":
    unittest.main()
