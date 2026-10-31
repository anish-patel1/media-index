# media index — Media URL Analyzer

A lightweight web application built with Python (Flask) and Vanilla JavaScript that parses media URLs (images, GIFs, videos), extracts hierarchical directory patterns, visually displays them in an interactive folder-like tree structure, and tracks duplicate submissions.

---

## 🎯 Purpose & Key Features

- **Storage Pattern Extraction**: Analyzes URL structures using standard URL parsing to extract domains, nested directory paths, and file resources.
- **Structured Tree-Table Explorer**: Transforms flat URL paths into an interactive directory tree-table (`<details>`/`<summary>`) with fixed column alignment (`NAME`, `TYPE`, `ADDED`, `REPEATS`), color-coded domain badges (`IMAGE SOURCE`, `DESIGN CDN`, `VIDEO SOURCE`), and media chips (`JPG`, `WEBP`, `GIF`, `MP4`).
- **Duplicate Tracking**: Tracks frequency of URL submissions. If an existing URL is submitted again, its duplicate count increments without creating duplicate tree branches, highlighted by pill badges (`↻ 2`).
- **Live Search & Branch Control**: Real-time substring search with match highlighting, live count badge, branch auto-expansion, and one-click Expand/Collapse/Copy ASCII tree controls.
- **Browser Session Isolation**: Automatically identifies browsers using a client-side UUID (`localStorage`) and namespaces data in `url_database.json`, ensuring complete privacy between users/browsers without requiring accounts.
- **Export & Import (Data Portability)**: Export your analyzed URLs with a standard timestamped file name (`media_index_export_<YYYY-MM-DD>_<HHMMSS>.json`) and seamlessly import/merge backup datasets.
- **Non-Intrusive Toast UX**: Modern top-right animated toast notifications with progress bars for every user action.
- **Modern SaaS Aesthetics**: Clean light-mode design matching the prototype with `DM Sans` typography, `IBM Plex Mono` code fonts, and subtle elevation on `#f7f8fc`.

---

## 🛠️ Tech Stack

- **Backend**: Python 3, Flask
- **Frontend**: Vanilla HTML5 (Semantic details/summary), Modern CSS3 (`DM Sans`, `IBM Plex Mono`), Vanilla JavaScript (ES6+)
- **Data Storage**: Namespaced JSON storage with atomic write protection

---

## 📁 Project Structure

```text
media-url-analyzer/
├── static/
│   ├── css/
│   │   └── style.css       # Custom glassmorphic styling & tree UI
│   └── js/
│       └── app.js          # Session UUID, API handling, toast system, tree rendering
├── templates/
│   └── index.html          # Two-column modern web interface
├── app.py                  # Flask routes, user scoping, export & import endpoints
├── database.py             # Multi-user JSON database manager & URL parsing logic
├── test_app.py             # Flask route integration test suite
├── test_database.py        # Database unit & migration test suite
├── url_database.json       # Persistent data storage (namespaced by user)
├── requirements.txt        # Python dependencies
└── README.md               # Project documentation
```

---

## 📊 Data Model (`url_database.json`)

```json
{
  "users": {
    "usr_uuid_or_default": {
      "urls": {
        "https://example.com/uploads/2026/images/photo.png": {
          "url": "https://example.com/uploads/2026/images/photo.png",
          "domain": "example.com",
          "path_segments": ["uploads", "2026", "images"],
          "filename": "photo.png",
          "extension": "png",
          "count": 2,
          "first_added": "2026-10-21T00:00:00Z",
          "last_updated": "2026-10-21T00:05:00Z"
        }
      }
    }
  }
}
```

---

## 🚀 Getting Started

### 1. Prerequisites
- install Python 3.8 or higher
- Set Up the Virtual environment (`venv`)

### 2. Installation
```bash
pip install -r requirements.txt
```

### 3. Running the Application
```bash
python app.py
```
Open your browser and navigate to `http://127.0.0.1:5000`.
