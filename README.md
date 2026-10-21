# Media URL Analyzer

A lightweight web application built with Python (Flask) and Vanilla JavaScript that parses media URLs (images, GIFs, videos), extracts hierarchical directory patterns, visually displays them in an interactive folder-like tree structure, and tracks duplicate submissions.

---

## 🎯 Purpose & Key Features

- **Storage Pattern Extraction**: Analyzes URL structures using standard URL parsing to extract domains, nested directory paths, and file resources.
- **Visual Folder Tree**: Transforms flat URL paths into an interactive directory tree (collapsible folders, extension-colored file nodes, live filter).
- **Duplicate Tracking**: Tracks frequency of URL submissions. If an existing URL is submitted again, its duplicate count increments without creating duplicate tree branches.
- **Browser Session Isolation**: Automatically identifies browsers using a client-side UUID (`localStorage`) and namespaces data in `url_database.json`, ensuring complete privacy between users/browsers without heavy login systems.
- **Export & Import (Data Portability)**: Export your analyzed URLs with a standard timestamped file name (`mua_export_<YYYY-MM-DD>_<HHMMSS>.json`) and seamlessly import/merge backup datasets.
- **Non-Intrusive Toast UX**: Replaced jarring auto-scroll with modern top-right animated toast notifications and soft in-place pulse animations.
- **Responsive Glassmorphism UI**: Two-column layout with quick clipboard pasting, live tree search, and collapsible branches.

---

## 🛠️ Tech Stack

- **Backend**: Python 3, Flask
- **Frontend**: Vanilla HTML5, Modern CSS3 (Glassmorphism), Vanilla JavaScript (ES6+)
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
