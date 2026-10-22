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

    def test_user_id_header_isolation(self):
        headers_a = {"X-User-Id": "client_session_a"}
        headers_b = {"X-User-Id": "client_session_b"}

        self.client.post("/api/urls", json={"url": "https://a.com/a.jpg"}, headers=headers_a)
        self.client.post("/api/urls", json={"url": "https://b.com/b.jpg"}, headers=headers_b)

        res_a = self.client.get("/api/tree", headers=headers_a)
        res_b = self.client.get("/api/tree", headers=headers_b)

        self.assertEqual(res_a.get_json()["stats"]["total_urls"], 1)
        self.assertEqual(res_a.get_json()["tree"][0]["name"], "a.com")
        self.assertEqual(res_b.get_json()["stats"]["total_urls"], 1)
        self.assertEqual(res_b.get_json()["tree"][0]["name"], "b.com")

    def test_export_endpoint(self):
        headers = {"X-User-Id": "export_client"}
        self.client.post("/api/urls", json={"url": "https://export.com/pic.png"}, headers=headers)

        export_res = self.client.get("/api/export", headers=headers)
        self.assertEqual(export_res.status_code, 200)
        self.assertEqual(export_res.mimetype, "application/json")
        self.assertIn("attachment; filename=mua_export_", export_res.headers.get("Content-Disposition", ""))

        data = json.loads(export_res.data)
        self.assertEqual(data["version"], "2.0")
        self.assertEqual(data["total_urls"], 1)

    def test_import_endpoint(self):
        headers = {"X-User-Id": "import_client"}
        import_payload = {
            "version": "2.0",
            "urls": {
                "https://importsite.com/media/clip.mp4": {
                    "url": "https://importsite.com/media/clip.mp4",
                    "domain": "importsite.com",
                    "path_segments": ["media"],
                    "filename": "clip.mp4",
                    "extension": "mp4",
                    "count": 5
                }
            }
        }
        import_res = self.client.post("/api/import", json=import_payload, headers=headers)
        self.assertEqual(import_res.status_code, 200)
        res_data = import_res.get_json()
        self.assertEqual(res_data["status"], "success")
        self.assertEqual(res_data["imported"], 1)

        tree_res = self.client.get("/api/tree", headers=headers)
        self.assertEqual(tree_res.get_json()["stats"]["total_urls"], 1)
        self.assertEqual(tree_res.get_json()["stats"]["total_submissions"], 5)

    def test_favicon(self):
        res = self.client.get("/favicon.ico")
        self.assertEqual(res.status_code, 200)


if __name__ == "__main__":
    unittest.main()

