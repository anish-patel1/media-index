# Media URL Analyzer

A lightweight web application built with Python (Flask) and Vanilla JavaScript that parses media URLs (images, GIFs, videos), extracts hierarchical directory patterns, visually displays them in an interactive folder-like tree structure, and tracks duplicate submissions.

---

## 🎯 Purpose & Key Features

- **Storage Pattern Extraction**: Analyzes URL structures using standard URL parsing to extract domains, nested directory paths, and file resources.
- **Visual Folder Tree**: Transforms flat URL paths into an interactive directory tree (collapsible folders, file nodes, media types).
- **Duplicate Tracking**: Tracks frequency of URL submissions. If an existing URL is submitted again, its paste count increments by `+1` without duplicate tree branches.
- **Persistent Local Storage**: Persists data in a local `url_database.json` file with safe read/write operations.
- **Responsive & Modern UI**: Built with semantic HTML, custom modern CSS, and lightweight Vanilla JavaScript.

---

## 🛠️ Tech Stack

- **Backend**: Python 3, Flask
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+)
- **Data Storage**: Local JSON database (`url_database.json`)

---

## 📁 Project Structure (Planned)

```text
media-url-analyzer/
├── static/
│   ├── css/
│   │   └── style.css       # Custom styles & tree UI styling
│   └── js/
│       └── app.js          # API calls, event handling, tree rendering
├── templates/
│   └── index.html          # Main web interface
├── app.py                  # Flask routes & server entrypoint
├── database.py             # JSON database manager & URL parsing logic
├── url_database.json       # Persistent data storage (generated)
├── requirements.txt        # Python dependencies
└── README.md               # Project documentation
```

---

## 📊 Data Model (`url_database.json`)

```json
{
  "urls": {
    "https://example.com/uploads/2026/images/photo.png": {
      "domain": "example.com",
      "path_segments": ["uploads", "2026", "images"],
      "filename": "photo.png",
      "count": 2,
      "first_added": "2026-10-21T00:00:00Z",
      "last_updated": "2026-10-21T00:05:00Z"
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
