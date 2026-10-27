import asyncio
import io
import json
import os
from datetime import datetime, timezone
from flask import Flask, render_template, request, jsonify, Response, send_file, send_from_directory
from database import URLDatabase
from enricher import MetadataEnricher


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


@app.route("/api/import", methods=["POST"])
def import_data():
    """Imports URLs into the caller's database from an uploaded JSON file or body."""
    user_id = get_user_id()
    try:
        import_payload = None
        if "file" in request.files:
            uploaded_file = request.files["file"]
            if not uploaded_file.filename:
                return jsonify({
                    "status": "error",
                    "message": "No file selected for upload."
                }), 400
            file_content = uploaded_file.read().decode("utf-8")
            import_payload = json.loads(file_content)
        elif request.is_json:
            import_payload = request.get_json(silent=True)

        if not import_payload:
            return jsonify({
                "status": "error",
                "message": "No JSON data provided. Please upload a JSON file or post JSON content."
            }), 400

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

