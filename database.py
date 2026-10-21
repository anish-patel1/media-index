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
        """Initializes the database file with default structure if it does not exist,
        and automatically migrates legacy un-namespaced schema to the multi-user schema.
        """
        if not os.path.exists(self.db_path):
            self._save({"users": {}})
        else:
            try:
                with open(self.db_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if not isinstance(data, dict):
                    self._save({"users": {}})
                    return

                # Auto-migration: If data has legacy top-level "urls", migrate under users["default"]
                if "urls" in data and "users" not in data:
                    migrated = {
                        "users": {
                            "default": {
                                "urls": data.get("urls", {})
                            }
                        }
                    }
                    self._save(migrated)
                elif "users" not in data:
                    self._save({"users": {}})
            except (json.JSONDecodeError, OSError):
                self._save({"users": {}})

    def _load(self) -> dict:
        """Reads and returns the data from the JSON file safely with auto-migration."""
        try:
            with open(self.db_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                return {"users": {}}
            if "urls" in data and "users" not in data:
                migrated = {
                    "users": {
                        "default": {
                            "urls": data.get("urls", {})
                        }
                    }
                }
                self._save(migrated)
                return migrated
            if "users" not in data:
                return {"users": {}}
            return data
        except (json.JSONDecodeError, OSError):
            return {"users": {}}

    def _save(self, data: dict) -> None:
        """Saves data to the JSON file safely using an atomic replace."""
        temp_path = f"{self.db_path}.tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(temp_path, self.db_path)

    def _resolve_user_urls(self, data: dict, user_id: str = "default", auto_claim: bool = False) -> tuple[dict, dict]:
        """Resolves the user records dictionary and the specific user's urls dictionary.
        If auto_claim is True, and the caller has a unique user_id (not 'default'),
        and only 'default' exists with URLs, claims 'default' for this first user.
        """
        users = data.setdefault("users", {})
        clean_user_id = (user_id or "default").strip()
        if not clean_user_id:
            clean_user_id = "default"

        if auto_claim and clean_user_id != "default" and clean_user_id not in users:
            # If default has URLs and this is the first unique user, claim the dataset
            if "default" in users and users["default"].get("urls"):
                users[clean_user_id] = users.pop("default")

        user_obj = users.setdefault(clean_user_id, {"urls": {}})
        return users, user_obj.setdefault("urls", {})

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

    def add_or_increment_url(self, raw_url: str, user_id: str = "default") -> dict:
        """Adds a URL to the user's database or increments its count if already registered.
        Returns details about the processed entry and duplicate status.
        """
        parsed_info = self.parse_url(raw_url)
        normalized_url = parsed_info["normalized_url"]

        data = self._load()
        _, urls = self._resolve_user_urls(data, user_id, auto_claim=True)
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

    def get_tree(self, user_id: str = "default") -> dict:
        """Reconstructs stored URLs for a specific user into a hierarchical folder-like tree
        structure grouped by domain and path segments. Also computes summary stats.
        """
        data = self._load()
        _, urls = self._resolve_user_urls(data, user_id, auto_claim=True)

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

    def clear(self, user_id: str = "default") -> dict:
        """Clears all stored entries for a specific user."""
        data = self._load()
        users = data.setdefault("users", {})
        clean_user_id = (user_id or "default").strip()
        if not clean_user_id:
            clean_user_id = "default"
        users[clean_user_id] = {"urls": {}}
        self._save(data)
        return {"status": "cleared", "message": "Database reset successfully."}

    def export_data(self, user_id: str = "default") -> dict:
        """Exports the stored URLs for the given user in standard JSON format."""
        data = self._load()
        _, urls = self._resolve_user_urls(data, user_id, auto_claim=False)
        return {
            "version": "2.0",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "user_id": user_id or "default",
            "total_urls": len(urls),
            "urls": urls
        }

    def import_data(self, import_payload: dict, user_id: str = "default") -> dict:
        """Imports URLs from a JSON structure into the specified user's database.
        Merges existing URLs: keeps higher count and most recent timestamp.
        Supports both legacy backup format ({"urls": {...}}) and exported format.
        """
        if not isinstance(import_payload, dict):
            raise ValueError("Import data must be a valid JSON object.")

        # Support {"urls": {...}}, {"version": ..., "urls": {...}}, or raw dict of entries
        urls_to_import = import_payload.get("urls")
        if urls_to_import is None:
            if all(isinstance(v, dict) and "url" in v for v in import_payload.values()):
                urls_to_import = import_payload
            elif "users" in import_payload and isinstance(import_payload["users"], dict):
                # If a full multi-user dump was provided, extract from first user or default
                first_u = next(iter(import_payload["users"].values()), {})
                urls_to_import = first_u.get("urls", {})
            else:
                raise ValueError("Invalid format: JSON must contain a 'urls' object.")

        if not isinstance(urls_to_import, dict):
            raise ValueError("'urls' must be a JSON object mapping URLs to entries.")

        data = self._load()
        _, urls = self._resolve_user_urls(data, user_id, auto_claim=False)

        imported_count = 0
        merged_count = 0

        for key, entry in urls_to_import.items():
            if not isinstance(entry, dict):
                continue

            url_key = entry.get("url") or key
            try:
                parsed_meta = self.parse_url(url_key)
            except ValueError:
                continue

            imp_count = entry.get("count", 1)
            try:
                imp_count = max(1, int(imp_count))
            except (ValueError, TypeError):
                imp_count = 1

            imp_first = entry.get("first_added") or datetime.now(timezone.utc).isoformat()
            imp_last = entry.get("last_updated") or datetime.now(timezone.utc).isoformat()

            if url_key in urls:
                existing = urls[url_key]
                existing["count"] = max(existing.get("count", 1), imp_count)
                if imp_last > existing.get("last_updated", ""):
                    existing["last_updated"] = imp_last
                merged_count += 1
            else:
                urls[url_key] = {
                    "url": url_key,
                    "domain": entry.get("domain") or parsed_meta["domain"],
                    "path_segments": entry.get("path_segments") or parsed_meta["path_segments"],
                    "filename": entry.get("filename") or parsed_meta["filename"],
                    "extension": entry.get("extension") or parsed_meta["extension"],
                    "count": imp_count,
                    "first_added": imp_first,
                    "last_updated": imp_last
                }
                imported_count += 1

        self._save(data)
        return {
            "status": "success",
            "imported": imported_count,
            "merged": merged_count,
            "total_urls": len(urls)
        }
