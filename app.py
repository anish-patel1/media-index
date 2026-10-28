import asyncio
import csv
import io
import json
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from flask import Flask, render_template, request, jsonify, Response, send_file, send_from_directory
from database import URLDatabase
from enricher import MetadataEnricher
from thumbnail_manager import get_or_create_thumbnail


# Initialize Flask app
app = Flask(__name__)

# Determine database path (allows override via environment variable for isolated tests)
DB_PATH = os.environ.get("URL_DB_PATH", "url_database.json")
db = URLDatabase(DB_PATH)


def get_user_id() -> str:
    """Extracts user identification from header, query parameter, or JSON body.
    Defaults to 'default' for non-namespaced backward compatibility.
    """
    # 1. Header (standard frontend flow)
    header_val = request.headers.get("X-User-Id")
    if header_val and header_val.strip():
        return header_val.strip()

    # 2. Query param
    query_val = request.args.get("user_id")
    if query_val and query_val.strip():
        return query_val.strip()

    # 3. JSON body
    if request.is_json:
        payload = request.get_json(silent=True)
        if isinstance(payload, dict) and payload.get("user_id"):
            val = str(payload.get("user_id")).strip()
            if val:
                return val

    return "default"


@app.route("/")
def index():
    """Renders the main web interface."""
    return render_template("index.html")


@app.route("/favicon.ico")
def favicon():
    """Serves the website favicon."""
    return send_from_directory(os.path.join(app.root_path, "static"), "favicon.ico", mimetype="image/x-icon")


@app.route("/api/urls", methods=["POST"])
def add_url():
    """Receives a URL, parses it, updates the user's database,
    and returns entry details including duplicate status.
    """
    if not request.is_json:
        return jsonify({
            "status": "error",
            "message": "Content-Type must be application/json."
        }), 400

    payload = request.get_json(silent=True)
    if not payload or "url" not in payload:
        return jsonify({
            "status": "error",
            "message": "Missing 'url' field in request payload."
        }), 400

    raw_url = payload.get("url")
    if not isinstance(raw_url, str) or not raw_url.strip():
        return jsonify({
            "status": "error",
            "message": "URL must be a non-empty string."
        }), 400

    user_id = get_user_id()

    try:
        result = db.add_or_increment_url(raw_url, user_id=user_id)
        status_code = 200 if result.get("is_duplicate") else 201
        return jsonify(result), status_code
    except ValueError as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 400
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"An unexpected error occurred: {str(e)}"
        }), 500


@app.route("/api/enrich", methods=["POST"])
def enrich_media():
    """Extracts Content-Length, Content-Type, dimensions, and CDN headers
    via lightweight async HEAD/ranged GET requests, and updates stored database entries.
    """
    if not request.is_json:
        return jsonify({
            "status": "error",
            "message": "Content-Type must be application/json."
        }), 400

    payload = request.get_json(silent=True) or {}
    raw_url = payload.get("url")
    raw_urls = payload.get("urls")
    update_db = payload.get("update_db", True)
    extract_dim = payload.get("extract_dimensions", True)
    user_id = get_user_id()

    if not raw_url and not raw_urls:
        return jsonify({
            "status": "error",
            "message": "Missing 'url' or 'urls' in request payload."
        }), 400

    async def _do_enrich():
        async with MetadataEnricher() as enricher:
            if raw_url:
                if not isinstance(raw_url, str) or not raw_url.strip():
                    raise ValueError("URL must be a non-empty string.")
                return await enricher.enrich_url(raw_url, extract_dimensions=extract_dim)
            else:
                if not isinstance(raw_urls, list):
                    raise ValueError("'urls' must be a list of URL strings.")
                clean_list = [str(u).strip() for u in raw_urls if str(u).strip()]
                return await enricher.enrich_batch(clean_list)

    try:
        result = asyncio.run(_do_enrich())

        if raw_url:
            db_updated = False
            if update_db and not result.get("error"):
                db_updated = db.update_url_metadata(raw_url, result, user_id=user_id)
            return jsonify({
                "status": "success",
                "metadata": result,
                "db_updated": db_updated,
            }), 200
        else:
            if update_db and isinstance(result, list):
                for item in result:
                    if isinstance(item, dict) and not item.get("error") and item.get("url"):
                        db.update_url_metadata(item["url"], item, user_id=user_id)
            return jsonify({
                "status": "success",
                "results": result,
                "count": len(result),
            }), 200

    except ValueError as ve:
        return jsonify({
            "status": "error",
            "message": str(ve)
        }), 400
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Enrichment failed: {str(e)}"
        }), 500

@app.route("/api/thumbnail", methods=["GET"])
def get_thumbnail():
    """Proxies and serves an optimized cached WebP thumbnail for a given media URL."""
    target_url = request.args.get("url")
    if not target_url or not target_url.strip():
        return jsonify({
            "status": "error",
            "message": "Missing 'url' query parameter."
        }), 400

    size_param = request.args.get("size", "150")
    try:
        size = int(size_param)
    except ValueError:
        size = 150

    thumb_path, err = get_or_create_thumbnail(target_url, size=size)
    if err or not thumb_path:
        return jsonify({
            "status": "error",
            "message": err or "Failed generating thumbnail."
        }), 404

    return send_file(
        thumb_path,
        mimetype="image/webp",
        max_age=86400,
    )


@app.route("/api/tree", methods=["GET"])
def get_tree():
    """Returns the visual folder tree hierarchy and aggregate statistics for the current user."""
    user_id = get_user_id()
    try:
        tree_data = db.get_tree(user_id=user_id)
        return jsonify({
            "status": "success",
            "tree": tree_data.get("tree", []),
            "stats": tree_data.get("stats", {})
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Failed to retrieve tree structure: {str(e)}"
        }), 500


@app.route("/api/clear", methods=["POST"])
def clear_database():
    """Resets the stored URLs in the database for the current user."""
    user_id = get_user_id()
    try:
        result = db.clear(user_id=user_id)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Failed to clear database: {str(e)}"
        }), 500


@app.route("/api/export", methods=["GET"])
def export_data():
    """Exports the caller's stored URL database as a downloadable JSON file.
    Follows standard filename pattern: mua_export_<YYYY-MM-DD>_<HHMMSS>.json
    """
    user_id = get_user_id()
    try:
        data = db.export_data(user_id=user_id)
        now_dt = datetime.now()
        timestamp_str = now_dt.strftime("%Y-%m-%d_%H%M%S")
        filename = f"mua_export_{timestamp_str}.json"

        json_bytes = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        return send_file(
            io.BytesIO(json_bytes),
            mimetype="application/json",
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Failed to export data: {str(e)}"
        }), 500


def _extract_urls_from_csv(text_content: str) -> list:
    """Sweeps all rows and cells in a CSV string using csv.reader,
    extracting any HTTP/HTTPS URLs via regex.
    """
    url_pattern = re.compile(r'https?://[^\s,"\'<>]+')
    extracted = []
    reader = csv.reader(io.StringIO(text_content))
    for row in reader:
        for cell in row:
            if cell:
                found = url_pattern.findall(cell)
                for u in found:
                    cleaned = u.rstrip(".,;)]")
                    if cleaned:
                        extracted.append(cleaned)
    return extracted


def _extract_urls_from_xml(text_content: str) -> list:
    """Parses XML sitemaps or feeds, extracting URLs from <loc>, <image:loc>,
    <video:content_loc>, <enclosure>, and any element text or attributes containing HTTP/HTTPS URLs.
    Falls back gracefully to regex sweeping if XML is slightly malformed.
    """
    url_pattern = re.compile(r'https?://[^\s,"\'<>]+')
    extracted = []
    seen = set()

    def add_if_valid(candidate: str):
        if not candidate:
            return
        found = url_pattern.findall(candidate)
        for u in found:
            cleaned = u.rstrip(".,;)]")
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                extracted.append(cleaned)

    try:
        root = ET.fromstring(text_content)
        for elem in root.iter():
            # Check element text (e.g. <loc>, <image:loc>)
            if elem.text and elem.text.strip():
                add_if_valid(elem.text.strip())
            # Check attributes (e.g. <enclosure url="..."> or <link href="...">)
            for attr_val in elem.attrib.values():
                if attr_val and isinstance(attr_val, str):
                    add_if_valid(attr_val.strip())
    except ET.ParseError:
        # Fallback to regex scan if XML has minor syntax issues or namespaces
        for u in url_pattern.findall(text_content):
            cleaned = u.rstrip(".,;)]")
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                extracted.append(cleaned)

    return extracted


def _extract_urls_from_text(text_content: str) -> list:
    """Extracts all HTTP/HTTPS URLs from plain text or multiline logs,
    stripping trailing punctuation and deduplicating while preserving order.
    """
    url_pattern = re.compile(r'https?://[^\s,"\'<>]+')
    extracted = []
    seen = set()
    for u in url_pattern.findall(text_content):
        cleaned = u.rstrip(".,;)]")
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            extracted.append(cleaned)
    return extracted


def _process_url_batch(urls: list, user_id: str, preview: bool = False, format_type: str = "csv") -> tuple:
    """Processes or previews a list of extracted URLs for a user."""
    if not urls:
        return {
            "status": "error",
            "message": f"No valid HTTP/HTTPS URLs found in uploaded {format_type.upper()}."
        }, 400

    if preview:
        data = db._load()
        _, existing_urls = db._resolve_user_urls(data, user_id, auto_claim=False)
        preview_items = []
        new_count = 0
        merged_count = 0
        for u in urls:
            try:
                parsed = db.parse_url(u)
                norm_url = parsed.get("normalized_url", u)
                is_dup = norm_url in existing_urls
                if is_dup:
                    merged_count += 1
                else:
                    new_count += 1
                preview_items.append({"url": norm_url, "is_duplicate": is_dup})
            except (ValueError, KeyError):
                continue

        return {
            "status": "preview",
            "format": format_type,
            "total_found": len(urls),
            "new_count": new_count,
            "duplicate_count": merged_count,
            "urls": preview_items[:100]
        }, 200

    imported_count = 0
    merged_count = 0
    failed_count = 0
    for u in urls:
        try:
            res = db.add_or_increment_url(u, user_id=user_id)
            if res.get("is_duplicate"):
                merged_count += 1
            else:
                imported_count += 1
        except ValueError:
            failed_count += 1
            continue

    return {
        "status": "success",
        "format": format_type,
        "imported": imported_count,
        "merged": merged_count,
        "failed": failed_count,
        "total_processed": imported_count + merged_count
    }, 200


@app.route("/api/import", methods=["POST"])
def import_data():
    """Imports URLs into the caller's database from uploaded JSON, CSV, XML, TXT, or raw payloads.
    Supports preview mode via ?preview=true.
    """
    user_id = get_user_id()
    preview_mode = request.args.get("preview", "").strip().lower() in ("true", "1", "yes")

    try:
        # 1. Multipart Form File Upload
        if "file" in request.files:
            uploaded_file = request.files["file"]
            if not uploaded_file.filename:
                return jsonify({
                    "status": "error",
                    "message": "No file selected for upload."
                }), 400

            filename_lower = uploaded_file.filename.lower()
            raw_bytes = uploaded_file.read()
            file_content = raw_bytes.decode("utf-8-sig", errors="replace")

            # Check if CSV by extension or mimetype
            is_csv = (
                filename_lower.endswith(".csv") or
                uploaded_file.mimetype in ("text/csv", "application/csv", "application/vnd.ms-excel")
            )
            # Check if XML by extension or mimetype
            is_xml = (
                filename_lower.endswith(".xml") or
                uploaded_file.mimetype in ("application/xml", "text/xml")
            )
            # Check if TXT by extension or mimetype
            is_txt = (
                filename_lower.endswith(".txt") or
                uploaded_file.mimetype == "text/plain"
            )

            if is_csv:
                urls = _extract_urls_from_csv(file_content)
                payload, code = _process_url_batch(urls, user_id, preview=preview_mode, format_type="csv")
                return jsonify(payload), code
            elif is_xml:
                urls = _extract_urls_from_xml(file_content)
                payload, code = _process_url_batch(urls, user_id, preview=preview_mode, format_type="xml")
                return jsonify(payload), code
            elif is_txt:
                urls = _extract_urls_from_text(file_content)
                payload, code = _process_url_batch(urls, user_id, preview=preview_mode, format_type="text")
                return jsonify(payload), code

            # Otherwise, treat as JSON
            import_payload = json.loads(file_content)

        # 2. Direct POST with text/csv
        elif request.content_type and "text/csv" in request.content_type:
            raw_text = request.get_data(as_text=True)
            urls = _extract_urls_from_csv(raw_text)
            payload, code = _process_url_batch(urls, user_id, preview=preview_mode, format_type="csv")
            return jsonify(payload), code

        # 3. Direct POST with application/xml or text/xml
        elif request.content_type and any(t in request.content_type for t in ("application/xml", "text/xml")):
            raw_text = request.get_data(as_text=True)
            urls = _extract_urls_from_xml(raw_text)
            payload, code = _process_url_batch(urls, user_id, preview=preview_mode, format_type="xml")
            return jsonify(payload), code

        # 4. Direct POST with text/plain
        elif request.content_type and "text/plain" in request.content_type:
            raw_text = request.get_data(as_text=True)
            urls = _extract_urls_from_text(raw_text)
            payload, code = _process_url_batch(urls, user_id, preview=preview_mode, format_type="text")
            return jsonify(payload), code

        # 5. Direct JSON Body
        elif request.is_json:
            import_payload = request.get_json(silent=True)
            if isinstance(import_payload, dict) and import_payload.get("preview"):
                preview_mode = True
        else:
            return jsonify({
                "status": "error",
                "message": "Unsupported content type. Upload a .json/.csv/.xml/.txt file or provide JSON/CSV/XML/TXT content."
            }), 400

        if not import_payload:
            return jsonify({
                "status": "error",
                "message": "No data provided. Please upload a file or provide payload content."
            }), 400

        # Handle JSON preview mode if requested
        if preview_mode:
            urls_map = import_payload.get("urls") if isinstance(import_payload, dict) else None
            if urls_map is None and isinstance(import_payload, dict):
                urls_map = import_payload
            raw_url_list = []
            if isinstance(urls_map, dict):
                for k, v in urls_map.items():
                    if isinstance(v, dict):
                        raw_url_list.append(v.get("url") or k)
                    elif isinstance(v, str):
                        raw_url_list.append(v)
            payload, code = _process_url_batch(raw_url_list, user_id, preview=True, format_type="json")
            return jsonify(payload), code

        result = db.import_data(import_payload, user_id=user_id)
        return jsonify(result), 200

    except json.JSONDecodeError:
        return jsonify({
            "status": "error",
            "message": "Invalid JSON format in uploaded file."
        }), 400
    except ValueError as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 400
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Failed to import data: {str(e)}"
        }), 500


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)

