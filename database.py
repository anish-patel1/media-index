import json
import os
from datetime import datetime, timezone
from urllib.parse import urlparse, unquote


class URLDatabase:
    """Manages URL parsing, persistence in a local JSON file, duplicate tracking,

    and hierarchical folder tree generation.
    """

    def __init__(self, db_path: str = "url_database.json"):
        # Resolve absolute path relative to current working directory or given path
        self.db_path = os.path.abspath(db_path)
        self._ensure_storage()

    def _ensure_storage(self) -> None:
        """Initializes the database file with default structure if it does not exist."""
        if not os.path.exists(self.db_path):
            self._save({"urls": {}})
        else:
            try:
                with open(self.db_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if not isinstance(data, dict) or "urls" not in data:
                        self._save({"urls": {}})
            except (json.JSONDecodeError, OSError):
                self._save({"urls": {}})

    def _load(self) -> dict:
        """Reads and returns the data from the JSON file safely."""
        try:
            with open(self.db_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {"urls": {}}

    def _save(self, data: dict) -> None:
        """Saves data to the JSON file safely using an atomic replace."""
        temp_path = f"{self.db_path}.tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(temp_path, self.db_path)

    @staticmethod
    def parse_url(raw_url: str) -> dict:
        """Parses a media URL into domain, path hierarchy segments, and filename.

        Raises ValueError if the URL format is invalid.
        """
        if not raw_url or not isinstance(raw_url, str):
            raise ValueError("URL must be a non-empty string.")

        clean_url = raw_url.strip()
        parsed = urlparse(clean_url)

        if not parsed.scheme or parsed.scheme.lower() not in ("http", "https"):
            raise ValueError("URL must have a valid HTTP or HTTPS protocol.")

        domain = parsed.netloc.lower()
        if not domain:
            raise ValueError("URL must include a valid domain name.")

        # Decode URL path components (e.g. %20 -> space)
        decoded_path = unquote(parsed.path)

        # Split path segments and remove empty strings
        raw_segments = [seg for seg in decoded_path.split("/") if seg]

        if not raw_segments:
            path_segments = []
            filename = "/"
        else:
            path_segments = raw_segments[:-1]
            filename = raw_segments[-1]

        # Determine media extension if present
        _, ext = os.path.splitext(filename)
        media_extension = ext.lower().lstrip(".") if ext else ""

        return {
            "normalized_url": clean_url,
            "domain": domain,
            "path_segments": path_segments,
            "filename": filename,
            "extension": media_extension,
            "query": parsed.query,
        }

    def add_or_increment_url(self, raw_url: str) -> dict:
        """Adds a URL to the database or increments its count if already registered.

        Returns details about the processed entry and duplicate status.
        """
        parsed_info = self.parse_url(raw_url)
        normalized_url = parsed_info["normalized_url"]

        data = self._load()
        urls = data.setdefault("urls", {})
        now_iso = datetime.now(timezone.utc).isoformat()

        if normalized_url in urls:
            # Increment duplicate count
            entry = urls[normalized_url]
            entry["count"] = entry.get("count", 1) + 1
            entry["last_updated"] = now_iso
            is_duplicate = True
        else:
            # Create new entry
            entry = {
                "url": normalized_url,
                "domain": parsed_info["domain"],
                "path_segments": parsed_info["path_segments"],
                "filename": parsed_info["filename"],
                "extension": parsed_info["extension"],
                "count": 1,
                "first_added": now_iso,
                "last_updated": now_iso,
            }
            urls[normalized_url] = entry
            is_duplicate = False

        self._save(data)

        return {
            "status": "success",
            "is_duplicate": is_duplicate,
            "count": entry["count"],
            "entry": entry,
        }

    def get_tree(self) -> dict:
        """Reconstructs all stored URLs into a hierarchical folder-like tree

        structure grouped by domain and path segments. Also computes summary stats.
        """
        data = self._load()
        urls = data.get("urls", {})

        total_urls = len(urls)
        total_submissions = sum(item.get("count", 1) for item in urls.values())
        duplicate_submissions = total_submissions - total_urls

        # Tree structure root as a dictionary mapping domain -> domain node
        domains_map = {}

        for entry in urls.values():
            domain = entry.get("domain", "unknown")
            path_segments = entry.get("path_segments", [])
            filename = entry.get("filename", "file")
            url = entry.get("url", "")
            count = entry.get("count", 1)
            extension = entry.get("extension", "")

            # Ensure domain node exists
            if domain not in domains_map:
                domains_map[domain] = {
                    "name": domain,
                    "type": "domain",
                    "children": {},
                }

            # Traverse or create folder nodes
            current_level = domains_map[domain]["children"]
            for seg in path_segments:
                if seg not in current_level:
                    current_level[seg] = {
                        "name": seg,
                        "type": "folder",
                        "children": {},
                    }
                current_level = current_level[seg]["children"]

            # Add file node
            file_key = f"__file__{filename}__{url}"
            current_level[file_key] = {
                "name": filename,
                "type": "file",
                "url": url,
                "count": count,
                "extension": extension,
                "last_updated": entry.get("last_updated"),
            }

        def convert_dict_to_list(node: dict) -> dict:
            """Recursively converts 'children' dictionaries to sorted lists."""
            if "children" in node:
                children_dict = node["children"]
                # Convert children
                converted_children = [
                    convert_dict_to_list(child) for child in children_dict.values()
                ]
                # Sort: folders first, then files alphabetically
                converted_children.sort(
                    key=lambda x: (0 if x["type"] in ("domain", "folder") else 1, x["name"].lower())
                )
                node["children"] = converted_children
            return node

        # Build final tree list
        tree = [convert_dict_to_list(d_node) for d_node in domains_map.values()]
        tree.sort(key=lambda x: x["name"].lower())

        return {
            "tree": tree,
            "stats": {
                "total_urls": total_urls,
                "total_submissions": total_submissions,
                "duplicate_submissions": duplicate_submissions,
            },
        }

    def clear(self) -> dict:
        """Clears all stored entries in the database."""
        self._save({"urls": {}})
        return {"status": "cleared", "message": "Database reset successfully."}
