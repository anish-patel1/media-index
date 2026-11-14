<div align="center">

# Media Index
### High-Performance Media URL Analyzer & Storage Pattern Explorer

Parse, structure, and explore media asset URLs across complex web directory hierarchies. Transform unstructured asset links into an interactive directory tree-table, visual grid gallery, and duplicate intelligence hub.

[![Edge Add-ons](https://img.shields.io/badge/Microsoft%20Edge-Available%20in%20Add--ons-0078D7?style=for-the-badge&logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/media-index-%E2%80%94-media-url-a/dpoeoaleioeannmbphghekfdmkamniok)
[![Python 3.8+](https://img.shields.io/badge/Python-3.8%2B-blue?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Browser%20Extension-Manifest%20V3-orange?style=for-the-badge&logo=googlechrome&logoColor=white)](extension/)

[Live Web App](https://media-index.onrender.com) • [Edge Add-on](https://microsoftedge.microsoft.com/addons/detail/media-index-%E2%80%94-media-url-a/dpoeoaleioeannmbphghekfdmkamniok) • [Core Features](#-core-features) • [Browser Extension](#-companion-browser-extension) • [Quick Start](#-quick-start) • [Architecture](#-project-architecture)

</div>

---

## 📖 Overview

Modern web workflows often involve dealing with hundreds of direct media URLs scattered across content delivery networks (CDNs), cloud storage buckets and web servers. **mediaIndex** bridges the gap between raw URLs and structured digital asset management.

By reverse-engineering directory patterns directly from HTTP/HTTPS URLs, mediaIndex transforms flat link dumps into a navigable file-system hierarchy with automated duplicate detection, sequential sibling discovery, perceptual visual clustering, and metadata enrichment—all with zero account creation and complete client-side data privacy.

---

## ✨ Core Features

### 🌲 Hierarchical Tree-Table & Visual Grid
- **Interactive Directory Hierarchy**: Automatically breaks down URL path segments into an expandable `<details>`/`<summary>` tree structure with fixed-column alignment (`NAME`, `TYPE`, `ADDED`, `REPEATS`).
- **Multi-View Modes**: Switch instantly between:
  - **Tree View**: Explore full directory paths and server structures.
  - **Grid Gallery**: Responsive visual card grid featuring cached preview thumbnails and quick actions.
  - **Clusters View**: Grouped views of identical and duplicate assets across distinct domains.
- **Focus Mode**: A streamlined, distraction-free inspection interface with quick keyboard shortcuts (`/` to input, `Ctrl+F` to search).

### 🔍 Magic Sibling Discovery Engine
- **Predictive Pattern Recognition**: Identifies sequential numerical naming conventions (e.g., `frame_001.jpg`, `item-02.png`, `clip_1.mp4`).
- **Zero-404 Verified Probing**: Executes non-destructive, asynchronous HTTP HEAD / range verification to discover sibling assets in the same directory without generating false positives.
- **Sequential Folder Scanning**: Discovers numbered sibling directories and adjacent batches automatically.
- **Intelligent CDN Classifier**: Recognizes hash-based standalone CDNs (e.g., Discord, Reddit, Unsplash) and bypasses redundant sequential checks.

### 🧬 Perceptual Duplicate Clustering
- **Visual Similarity Detection**: Uses 64-bit perceptual difference hashing (`dHash`) to identify duplicate or resized images across different mirrors, CDNs, or query parameters.
- **Canonical URL Attribution**: Automatically groups asset variants, tags canonical primary sources, and tracks repeat frequency counters (`↻ 2`).
- **Cluster Management**: Dismiss false-positive matches or reset clusters with a single click.

### ⚡ Metadata Enrichment & CDN Attribution
- **Non-Download Inspection**: Queries headers asynchronously via HTTP HEAD / ranged GET without pulling full media payloads.
- **Infrastructure Fingerprinting**: Identifies CDN and hosting providers (Cloudflare, AWS CloudFront / S3, Fastly, Akamai, Google Cloud Storage).
- **Asset Metadata**: Extracts `Content-Length` (file size), `Content-Type` (MIME validation), and `Last-Modified` timestamps.

### 🔒 Client-Isolated Privacy & Full Portability
- **Zero-Signup Isolation**: Automatically scopes sessions via a client-generated UUID stored strictly in browser `localStorage`.
- **Atomic Multi-Tenant Storage**: Backed by high-reliability namespaced storage with atomic file-write locks.
- **Universal Import & Export**: Export backups into timestamped JSON files; import and merge datasets from JSON, CSV, XML, or raw TXT URL lists.

---

## 🧩 Companion Browser Extension

The **mediaIndex Companion Extension** (Manifest V3) allows you to capture, analyze, and index media assets directly from any web page into your mediaIndex library with a single click.

<div align="center">

[![Install on Microsoft Edge](https://img.shields.io/badge/Microsoft%20Edge%20Store-Install%20Now-0078D7?style=for-the-badge&logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/media-index-%E2%80%94-media-url-a/dpoeoaleioeannmbphghekfdmkamniok)

</div>

### Key Capabilities
- **One-Click Page Inspection**: Scan any active browser tab for images, videos, and GIFs with live preview thumbnails.
- **Context Menu Integration**: Right-click any media asset or link on any webpage and select **"Send to mediaIndex"**.
- **Zero-Config Identity Sync**: Automatically pairs with your active web dashboard user ID via an origin-bounded storage bridge—no API keys or tokens to copy.
- **Dual-Environment Routing**: Pre-configured for the live cloud instance, with an instant toggle for local development (`http://127.0.0.1:5000`).
- **Cloud Wake-Up Resilience**: Built-in cold-start polling that smoothly manages cloud server wake-ups with real-time status notifications.

---

## 📦 Extension Installation Guide

### Option A: Microsoft Edge (Recommended)
Install directly from the official Microsoft Edge Add-ons store with automatic background updates:
1. Navigate to the [Media Index Add-on Page](https://microsoftedge.microsoft.com/addons/detail/media-index-%E2%80%94-media-url-a/dpoeoaleioeannmbphghekfdmkamniok).
2. Click **Get** and confirm by clicking **Add extension**.
3. Pin the extension icon to your toolbar for quick access.

---

### Option B: Google Chrome, Brave, and Chromium Browsers
Install in seconds via Chromium Developer Mode (no Git or command line required):

1. **Download the Extension**:
   - Download [`media-index-extension.zip`](https://github.com/anish-patel1/media-index/releases/latest/download/media-index-extension.zip) from the latest [GitHub Releases](https://github.com/anish-patel1/media-index/releases).
   - Extract the `.zip` archive to a folder on your computer.
   *(Developers can alternatively run `git clone https://github.com/anish-patel1/media-index.git`)*

2. **Open Extensions Management**:
   - **Chrome**: Navigate to `chrome://extensions/`
   - **Brave**: Navigate to `brave://extensions/`

3. **Enable Developer Mode**:
   - Toggle the **Developer mode** switch in the top-right corner.

4. **Load Unpacked Extension**:
   - Click **Load unpacked** in the top-left toolbar.
   - Select the extracted `extension/` folder.
   - Pin **mediaIndex** to your browser toolbar for quick access.

> **Configuring the Backend Environment**:  
> By default, the extension sends media to the production cloud service (`https://media-index.onrender.com`).  
> To connect to your local backend, right-click the extension icon, choose **Extension options**, toggle **Developer Mode** to **ON**, and set your endpoint (default: `http://127.0.0.1:5000`).

---

## 🛠️ How it Works

```
                                      [Web Browser / Page]
                                                │
                                    (1-Click or Context Menu)
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          mediaIndex Browser Extension                       │
│      • Asset Discovery (DOM / Network)    • Zero-Config User Bridge         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP POST (Ingest / Analyze)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             mediaIndex Backend                              │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐  │
│  │  Storage Path Parser  │  │   Metadata Enricher   │  │ Sibling Engine  │  │
│  │ (Domain, Path, MIME)  │  │ (Async HEAD, CDN tags)│  │ (Sequence Probes│  │
│  └───────────┬───────────┘  └───────────┬───────────┘  └────────┬────────┘  │
│              │                          │                       │           │
│              ▼                          ▼                       ▼           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │          Cluster & Duplicate Engine (Perceptual dHash, Repeats)       │  │
│  └──────────────────────────────────┬────────────────────────────────────┘  │
│                                     │                                       │
│                                     ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │           Namespaced Multi-User Store (Atomic JSON Database)          │  │
│  └──────────────────────────────────┬────────────────────────────────────┘  │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │ JSON API Response
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Client UI Dashboard                             │
│       [Tree-Table Explorer]    [Visual Grid Gallery]    [Cluster Hub]       │
└─────────────────────────────────────────────────────────────────────────────┘
```

1. **Ingest**: Media URLs are received via the web dashboard input, batch file import, or companion browser extension.
2. **Deconstruct**: Standardized URI decomposition resolves protocol, hostnames, nested folders, file roots, and query params.
3. **Analyze & Probe**:
   - Asynchronous HEAD requests fetch MIME type, size, and CDN indicators without pulling large assets.
   - Numbered patterns trigger the Sibling Discovery Engine to find adjacent sequences.
4. **Cluster & Deduplicate**: The cluster engine evaluates perceptual hashes and path equivalence to detect mirrors and increment repeat counters.
5. **Render**: The dashboard displays the resulting structure in synchronized Tree, Grid, or Cluster views.

---

## 🚀 Quick Start (Local Backend)

### Prerequisites
- Python 3.8 or higher
- Git

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/anish-patel1/media-index.git
   cd media-index
   ```

2. **Create and activate a virtual environment**:
   ```bash
   # Windows
   python -m venv venv
   .\venv\Scripts\activate

   # macOS / Linux
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Launch the application**:
   ```bash
   python app.py
   ```

5. **Open in browser**:
   Navigate to [http://127.0.0.1:5000](http://127.0.0.1:5000).

---

## 🧪 Testing

mediaIndex includes a comprehensive test suite covering route handling, multi-user database scoping, sibling discovery, thumbnail caching, and cluster hashing:

```bash
# Run all test suites
pytest

# Run individual test modules
pytest test_app.py
pytest test_database.py
pytest test_sibling_engine.py
pytest test_cluster.py
pytest test_enricher.py
```

---

## 📁 Project Architecture

```text
media-index/
├── domain_strategies/         # Domain-specific path resolution overrides
├── extension/                 # Manifest V3 companion browser extension
│   ├── icons/                 # Extension toolbar and store icon assets
│   ├── background.js          # Service worker, context menus, and cold-start polling
│   ├── config.js              # Centralized environment URLs and timeouts
│   ├── content.js             # Asset scraper and user identity bridge
│   ├── manifest.json          # Chrome / Edge Manifest V3 definition
│   ├── options.html / .js     # Developer mode and endpoint configuration UI
│   └── popup.html / .js / .css# Extension popup inspection and capture interface
├── static/                    # Frontend assets
│   ├── css/style.css          # Design system, tree UI, and grid styling
│   └── js/app.js              # State manager, keyboard shortcuts, view router
├── templates/
│   └── index.html             # Multi-view dashboard interface
├── app.py                     # Flask application routes, REST API, error handlers
├── cluster_engine.py          # Perceptual image hashing (dHash) and duplicate clustering
├── database.py                # Multi-tenant JSON database manager with atomic writes
├── enricher.py                # Asynchronous metadata probe and CDN fingerprinting
├── sibling_engine.py          # Sequence pattern matcher and zero-404 probing engine
├── thumbnail_manager.py       # Local thumbnail cache and WebP optimizer
├── requirements.txt           # Python package dependencies
└── README.md                  # Project documentation
```

---

## 🔒 Privacy & Data Policy

- **No Tracking or Telemetry**: mediaIndex does not collect personal identifiers, telemetry, or analytics.
- **Client-Side Partitioning**: All database namespaces are driven by private client UUIDs generated in the user's browser.
- **Safe Probing**: The sibling discovery engine uses non-destructive HTTP HEAD requests and respects domain exclusion boundaries.

---

## 📄 License

This project is open-source and distributed under the [MIT License](LICENSE).
