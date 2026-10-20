import os
from flask import Flask, render_template, request, jsonify
from database import URLDatabase

# Initialize Flask app
app = Flask(__name__)

# Determine database path (allows override via environment variable for isolated tests)
DB_PATH = os.environ.get("URL_DB_PATH", "url_database.json")
db = URLDatabase(DB_PATH)


@app.route("/")
def index():
    """Renders the main web interface."""
    return render_template("index.html")


@app.route("/api/urls", methods=["POST"])
def add_url():
    """Receives a URL, parses it, updates the database,

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

    try:
        result = db.add_or_increment_url(raw_url)
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


@app.route("/api/tree", methods=["GET"])
def get_tree():
    """Returns the visual folder tree hierarchy and aggregate statistics."""
    try:
        tree_data = db.get_tree()
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
    """Resets the stored URLs in the database."""
    try:
        result = db.clear()
        return jsonify(result), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Failed to clear database: {str(e)}"
        }), 500


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
