/**
 * Media Library — Modern Client Application
 * Matches prototype UI: https://mediaurl-ngejbjg9.manus.space/
 * 
 * Features:
 * - Silent user-scoping via localStorage and X-User-Id header
 * - Structured Tree-Table rendering with details/summary and column alignment
 * - Dynamic domain badges, folder paths, and file type chips (JPG, WEBP, GIF, MP4, etc.)
 * - Duplicate repeat count pills (↻ N)
 * - Live search with branch auto-expansion and match highlighting
 * - Expand all / Collapse all toggle
 * - Backup JSON export and merge import
 * - Reset database with confirmation modal
 * - Top-right floating animated toasts
 */

document.addEventListener('DOMContentLoaded', () => {
    // -------------------------------------------------------------
    // 1. Silent User Identity Management
    // -------------------------------------------------------------
    function getOrCreateUserId() {
        const STORAGE_KEY = 'mua_user_id';
        let stored = localStorage.getItem(STORAGE_KEY);
        if (!stored || !stored.trim()) {
            stored = 'default';
            localStorage.setItem(STORAGE_KEY, stored);
        }
        try {
            window.dispatchEvent(new CustomEvent('media-index-auth-change', { detail: { userId: stored } }));
        } catch {}
        return stored;
    }

    const currentUserId = getOrCreateUserId();

    function authFetch(url, options = {}) {
        const headers = options.headers ? { ...options.headers } : {};
        headers['X-User-Id'] = currentUserId;
        return fetch(url, { ...options, headers });
    }

    // -------------------------------------------------------------
    // 1B. Client-Side Persistent Local Storage Database (LocalStorageDB)
    // Bulletproof persistence resilient against Render ephemeral dyno spin-downs
    // -------------------------------------------------------------
    const LocalStorageDB = {
        STORAGE_KEY: `media_index_db_${currentUserId}`,
        DISMISSED_KEY: `media_index_dismissed_${currentUserId}`,

        load() {
            try {
                const raw = localStorage.getItem(this.STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object' && parsed.urls) {
                        return parsed;
                    }
                }
            } catch (e) {
                console.warn('LocalStorageDB load error:', e);
            }
            return { urls: {} };
        },

        save(data) {
            try {
                if (!data || typeof data !== 'object') data = { urls: {} };
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
            } catch (e) {
                console.error('LocalStorageDB save quota exceeded or error:', e);
            }
        },

        getUrls() {
            return this.load().urls || {};
        },

        hasUrl(url) {
            if (!url) return false;
            const urls = this.getUrls();
            return Boolean(urls[url.trim()]);
        },

        addOrIncrement(entry) {
            if (!entry || !entry.url) return;
            const data = this.load();
            const url = entry.url.trim();
            const nowIso = new Date().toISOString();

            if (data.urls[url]) {
                const existing = data.urls[url];
                existing.count = (existing.count || 1) + 1;
                existing.last_updated = nowIso;
                if (entry.metadata && typeof entry.metadata === 'object') {
                    existing.metadata = { ...(existing.metadata || {}), ...entry.metadata };
                }
            } else {
                data.urls[url] = {
                    url: url,
                    domain: entry.domain || 'unknown',
                    path_segments: entry.path_segments || [],
                    filename: entry.filename || 'file',
                    extension: (entry.extension || '').toLowerCase(),
                    count: entry.count || 1,
                    first_added: entry.first_added || nowIso,
                    last_updated: entry.last_updated || nowIso,
                    metadata: entry.metadata || {}
                };
            }
            this.save(data);
        },

        updateMetadata(url, metadata) {
            if (!url || !metadata) return false;
            const data = this.load();
            const cleanUrl = url.trim();
            if (data.urls[cleanUrl]) {
                data.urls[cleanUrl].metadata = { ...(data.urls[cleanUrl].metadata || {}), ...metadata };
                data.urls[cleanUrl].last_updated = new Date().toISOString();
                this.save(data);
                return true;
            }
            return false;
        },

        deleteUrls(urlsToDelete) {
            if (!urlsToDelete || !urlsToDelete.length) return 0;
            const data = this.load();
            let count = 0;
            urlsToDelete.forEach(u => {
                const clean = String(u).trim();
                if (data.urls[clean]) {
                    delete data.urls[clean];
                    count++;
                }
            });
            if (count > 0) this.save(data);
            return count;
        },

        clear() {
            this.save({ urls: {} });
        },

        getDismissedClusters() {
            try {
                const raw = localStorage.getItem(this.DISMISSED_KEY);
                return raw ? JSON.parse(raw) : [];
            } catch {
                return [];
            }
        },

        dismissCluster(clusterId) {
            if (!clusterId) return;
            const list = this.getDismissedClusters();
            if (!list.includes(clusterId)) {
                list.push(clusterId);
                localStorage.setItem(this.DISMISSED_KEY, JSON.stringify(list));
            }
        },

        resetDismissedClusters() {
            localStorage.setItem(this.DISMISSED_KEY, JSON.stringify([]));
        },

        exportData() {
            const urls = this.getUrls();
            return {
                version: "2.0",
                exported_at: new Date().toISOString(),
                user_id: currentUserId,
                total_urls: Object.keys(urls).length,
                urls: urls
            };
        },

        importData(payload) {
            if (!payload || typeof payload !== 'object') return { imported: 0, merged: 0 };
            const urlsToImport = payload.urls || (allEntriesAreUrls(payload) ? payload : {});
            function allEntriesAreUrls(obj) {
                const vals = Object.values(obj);
                return vals.length > 0 && vals.every(v => v && typeof v === 'object' && v.url);
            }

            const data = this.load();
            let imported = 0;
            let merged = 0;
            const nowIso = new Date().toISOString();

            Object.entries(urlsToImport).forEach(([key, entry]) => {
                if (!entry || typeof entry !== 'object') return;
                const u = (entry.url || key || '').trim();
                if (!u) return;

                if (data.urls[u]) {
                    const existing = data.urls[u];
                    existing.count = Math.max(existing.count || 1, entry.count || 1);
                    if (entry.last_updated && entry.last_updated > (existing.last_updated || '')) {
                        existing.last_updated = entry.last_updated;
                    }
                    if (entry.metadata && typeof entry.metadata === 'object') {
                        existing.metadata = { ...(existing.metadata || {}), ...entry.metadata };
                    }
                    merged++;
                } else {
                    data.urls[u] = {
                        url: u,
                        domain: entry.domain || 'unknown',
                        path_segments: entry.path_segments || [],
                        filename: entry.filename || 'file',
                        extension: (entry.extension || '').toLowerCase(),
                        count: entry.count || 1,
                        first_added: entry.first_added || nowIso,
                        last_updated: entry.last_updated || nowIso,
                        metadata: entry.metadata || {}
                    };
                    imported++;
                }
            });

            this.save(data);
            return { imported, merged, total: Object.keys(data.urls).length };
        }
    };

    // Client-side hierarchical folder tree builder from localStorage data
    function buildTreeFromLocalEntries(urlsMap) {
        const entries = Object.values(urlsMap || {});
        const total_urls = entries.length;
        let total_submissions = 0;
        entries.forEach(e => { total_submissions += (e.count || 1); });
        const duplicate_submissions = total_submissions - total_urls;

        const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "svg", "avif", "bmp", "ico"]);
        const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "m4v", "ogv", "avi", "mkv"]);
        const GIF_EXTS = new Set(["gif"]);

        const domainsMap = {};

        entries.forEach(entry => {
            const domain = entry.domain || "unknown";
            const path_segments = entry.path_segments || [];
            const filename = entry.filename || "file";
            const url = entry.url || "";
            const count = entry.count || 1;
            const extension = (entry.extension || "").toLowerCase();

            let media_type = "other";
            if (GIF_EXTS.has(extension)) media_type = "gif";
            else if (VIDEO_EXTS.has(extension)) media_type = "video";
            else if (IMAGE_EXTS.has(extension)) media_type = "image";

            const metadata = entry.metadata || {};
            if (media_type === "other" && metadata && metadata.mime_type) {
                const mime = String(metadata.mime_type).toLowerCase();
                if (mime.includes("image")) media_type = "image";
                else if (mime.includes("video")) media_type = "video";
                else if (mime.includes("audio")) media_type = "audio";
                else if (mime.includes("gif")) media_type = "gif";
            }

            if (!domainsMap[domain]) {
                domainsMap[domain] = {
                    name: domain,
                    type: "domain",
                    children: {}
                };
            }

            let currentLevel = domainsMap[domain].children;
            const accumulatedPath = [];
            path_segments.forEach(seg => {
                accumulatedPath.push(seg);
                if (!currentLevel[seg]) {
                    currentLevel[seg] = {
                        name: seg,
                        type: "folder",
                        path: `/${accumulatedPath.join('/')}/`,
                        children: {}
                    };
                }
                currentLevel = currentLevel[seg].children;
            });

            const fileKey = `__file__${filename}__${url}`;
            currentLevel[fileKey] = {
                name: filename,
                type: "file",
                url: url,
                count: count,
                extension: extension ? extension.toUpperCase() : "FILE",
                media_type: media_type,
                first_added: entry.first_added,
                last_updated: entry.last_updated,
                metadata: metadata
            };
        });

        function processNode(node) {
            if (node.children) {
                const childrenArray = Object.values(node.children).map(child => processNode(child));
                childrenArray.sort((a, b) => {
                    const aOrder = (a.type === 'domain' || a.type === 'folder') ? 0 : 1;
                    const bOrder = (b.type === 'domain' || b.type === 'folder') ? 0 : 1;
                    if (aOrder !== bOrder) return aOrder - bOrder;
                    return (a.name || '').localeCompare(b.name || '');
                });
                node.children = childrenArray;

                let filesCount = 0;
                let foldersCount = 0;
                let latestTs = null;
                const typeCounts = { image: 0, video: 0, gif: 0, other: 0 };

                childrenArray.forEach(child => {
                    if (child.type === 'file') {
                        filesCount++;
                        const m = child.media_type || 'other';
                        typeCounts[m] = (typeCounts[m] || 0) + 1;
                        const ts = child.last_updated || child.first_added;
                        if (ts && (!latestTs || ts > latestTs)) latestTs = ts;
                    } else if (child.type === 'folder') {
                        foldersCount += 1 + (child.folders_count || 0);
                        filesCount += (child.files_count || 0);
                        const ts = child.last_updated;
                        if (ts && (!latestTs || ts > latestTs)) latestTs = ts;
                        if (child.type_counts) {
                            Object.entries(child.type_counts).forEach(([k, v]) => {
                                typeCounts[k] = (typeCounts[k] || 0) + v;
                            });
                        }
                    }
                });

                node.files_count = filesCount;
                node.folders_count = foldersCount;
                node.last_updated = latestTs;
                node.type_counts = typeCounts;

                if (node.type === 'domain') {
                    node.items_count = filesCount;
                    const domainLower = (node.name || '').toLowerCase();
                    if (domainLower.includes('cdn')) {
                        if (domainLower.includes('design') || domainLower.includes('studio')) {
                            node.domain_type = 'DESIGN CDN';
                        } else {
                            node.domain_type = 'CONTENT CDN';
                        }
                        node.domain_color = 'coral';
                    } else if ((typeCounts.video || 0) > (typeCounts.image || 0)) {
                        node.domain_type = 'VIDEO SOURCE';
                        node.domain_color = 'blue';
                    } else {
                        node.domain_type = 'IMAGE SOURCE';
                        node.domain_color = 'violet';
                    }
                }
            }
            return node;
        }

        const tree = Object.values(domainsMap).map(dNode => processNode(dNode));
        tree.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        return {
            tree: tree,
            stats: {
                total_urls: total_urls,
                total_submissions: total_submissions,
                duplicate_submissions: duplicate_submissions,
                total_sources: Object.keys(domainsMap).length
            }
        };
    }

    // -------------------------------------------------------------
    // 2. DOM Elements
    // -------------------------------------------------------------
    const urlForm = document.getElementById('url-form');
    const urlInput = document.getElementById('url-input');
    const clearUrlBtn = document.getElementById('clear-url-btn');
    const submitBtn = document.getElementById('submit-url-btn');
    const pasteBtn = document.getElementById('paste-clipboard-btn');
    const captureStatus = document.getElementById('capture-status');

    // Header & Stats
    const statTotalMedia = document.getElementById('stat-total-media');
    const statSources = document.getElementById('stat-sources');
    const statRepeats = document.getElementById('stat-repeats');
    const treeCountBadge = document.getElementById('tree-count-badge');
    const footerCount = document.getElementById('footer-count');

    // Export & Import
    const exportBtn = document.getElementById('export-btn');
    const importBtn = document.getElementById('import-btn');
    const importFileInput = document.getElementById('import-file-input');

    // Import Preview Modal & Drag-Drop Overlay
    const dragDropOverlay = document.getElementById('drag-drop-overlay');
    const importPreviewModal = document.getElementById('import-preview-modal');
    const importModalSubtitle = document.getElementById('import-modal-subtitle');
    const importTotalFound = document.getElementById('import-total-found');
    const importNewCount = document.getElementById('import-new-count');
    const importDupCount = document.getElementById('import-dup-count');
    const importPreviewList = document.getElementById('import-preview-list');
    const cancelImportBtn = document.getElementById('cancel-import-btn');
    const confirmImportBtn = document.getElementById('confirm-import-btn');
    const confirmImportText = document.getElementById('confirm-import-text');

    // Reset Modal
    const resetDbBtn = document.getElementById('reset-db-btn');
    const resetModal = document.getElementById('reset-modal');
    const cancelResetBtn = document.getElementById('cancel-reset-btn');
    const confirmResetBtn = document.getElementById('confirm-reset-btn');

    // Generic Confirmation Modal
    const confirmModal = document.getElementById('confirm-modal');
    const confirmModalTitle = document.getElementById('confirm-modal-title');
    const confirmModalBody = document.getElementById('confirm-modal-body');
    const confirmModalIcon = document.getElementById('confirm-modal-icon');
    const confirmModalOkBtn = document.getElementById('confirm-modal-ok-btn');
    const confirmModalCancelBtn = document.getElementById('confirm-modal-cancel-btn');

    // Tree & Search Toolbar
    const treeContainer = document.getElementById('tree-container');
    const treeSearchInput = document.getElementById('tree-search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const expandAllBtn = document.getElementById('expand-all-btn');
    const collapseAllBtn = document.getElementById('collapse-all-btn');

    // Show/Hide & Focus Toolbar Controls
    const toggleFoldersBtn = document.getElementById('toggle-tree-folders-btn');
    const toggleFoldersText = document.getElementById('toggle-folders-text');
    const toggleFocusModeBtn = document.getElementById('toggle-focus-mode-btn');
    const focusModeText = document.getElementById('focus-mode-text');
    const pageWrap = document.getElementById('page-wrap');
    const mediaTypeFilters = document.getElementById('media-type-filters');
    const activeFilterBadge = document.getElementById('active-filter-badge');
    const filterCountImage = document.getElementById('filter-count-image');
    const filterCountVideo = document.getElementById('filter-count-video');
    const filterCountGif = document.getElementById('filter-count-gif');

    // View Mode Toggle
    const viewModeToggle = document.getElementById('view-mode-toggle');
    const viewTreeBtn = document.getElementById('view-tree-btn');
    const viewGridBtn = document.getElementById('view-grid-btn');
    const viewClustersBtn = document.getElementById('view-clusters-btn');
    const clustersBadge = document.getElementById('clusters-badge');
    const librarySection = document.querySelector('.library-section');
    const librarySubtitle = document.getElementById('library-subtitle');
    const tableHead = document.getElementById('table-head');

    // Floating Hover Preview Card Elements
    const floatingPreviewCard = document.getElementById('floating-preview-card');
    const previewCardImg = document.getElementById('preview-card-img');
    const previewCardVideo = document.getElementById('preview-card-video');
    const previewCardFallback = document.getElementById('preview-card-fallback');
    const previewThumbSkeleton = document.querySelector('.preview-thumb-skeleton');
    const previewDimBadge = document.getElementById('preview-dim-badge');
    const previewCardExt = document.getElementById('preview-card-ext');
    const previewCardName = document.getElementById('preview-card-name');
    const previewMetaSize = document.getElementById('preview-meta-size');
    const previewMetaDim = document.getElementById('preview-meta-dim');
    const previewMetaCdn = document.getElementById('preview-meta-cdn');
    const previewMetaMime = document.getElementById('preview-meta-mime');
    const previewCopyBtn = document.getElementById('preview-copy-btn');
    const previewOpenLink = document.getElementById('preview-open-link');

    // Global file and folder lookup maps
    const fileLookupMap = new Map();
    const folderLookupMap = new Map();

    // Toast Container
    const toastContainer = document.getElementById('toast-container');


    // State Variables
    let rawTreeData = [];
    let currentSearchQuery = '';
    let lastUpdatedUrl = null;
    const VIEW_MODE_KEY = 'media_view_mode';
    let currentViewMode = localStorage.getItem(VIEW_MODE_KEY) || 'tree';
    let rawClustersData = null;
    let currentMediaTypeFilter = 'all'; // 'all' | 'image' | 'video' | 'gif'
    const FOCUS_MODE_KEY = 'mua_focus_mode';
    let isFocusMode = localStorage.getItem(FOCUS_MODE_KEY) === '1';

    // -------------------------------------------------------------
    // 3. Floating Toast Notifications
    // -------------------------------------------------------------
    const TOAST_ICONS = {
        success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
        duplicate: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
        error: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
        info: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
    };

    function showToast(title, message, type = 'info', duration = null) {
        if (!toastContainer) return;

        // Auto-dismiss tiering: Standard 3500ms vs Important/Error 6500ms
        const effectiveDuration = duration !== null && duration !== undefined 
            ? duration 
            : (type === 'error' ? 6500 : 3500);

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const iconHtml = TOAST_ICONS[type] || TOAST_ICONS.info;
        toast.innerHTML = `
            ${iconHtml}
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button type="button" class="toast-close-btn" aria-label="Dismiss notification">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <div class="toast-progress" style="animation-duration: ${effectiveDuration}ms;"></div>
        `;

        const dismiss = () => {
            if (toast.classList.contains('toast-hiding')) return;
            toast.classList.add('toast-hiding');
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 250);
        };

        const closeBtn = toast.querySelector('.toast-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', dismiss);

        let remainingTime = effectiveDuration;
        let timerStart = Date.now();
        let autoTimer = setTimeout(dismiss, effectiveDuration);

        toast.addEventListener('mouseenter', () => {
            clearTimeout(autoTimer);
            remainingTime -= (Date.now() - timerStart);
            if (remainingTime < 1000) remainingTime = 1500;
            const progress = toast.querySelector('.toast-progress');
            if (progress) progress.style.animationPlayState = 'paused';
        });

        toast.addEventListener('mouseleave', () => {
            clearTimeout(autoTimer);
            timerStart = Date.now();
            autoTimer = setTimeout(dismiss, remainingTime);
            const progress = toast.querySelector('.toast-progress');
            if (progress) progress.style.animationPlayState = 'running';
        });

        toastContainer.appendChild(toast);
    }

    // -------------------------------------------------------------
    // 3b. Generic Confirmation Modal Controller (Promise-based)
    // -------------------------------------------------------------
    let activeConfirmResolver = null;

    function closeConfirmModal(result = false) {
        if (!confirmModal) return;
        confirmModal.classList.remove('active');
        if (activeConfirmResolver) {
            const resolve = activeConfirmResolver;
            activeConfirmResolver = null;
            resolve(result);
        }
    }

    function showConfirmModal({
        title = 'Confirm Action',
        body = 'Are you sure you want to proceed?',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        danger = true,
        iconType = 'danger'
    } = {}) {
        if (!confirmModal) {
            return Promise.resolve(window.confirm(body));
        }

        if (confirmModalTitle) confirmModalTitle.textContent = title;
        if (confirmModalBody) confirmModalBody.textContent = body;
        if (confirmModalOkBtn) {
            confirmModalOkBtn.textContent = confirmText;
            confirmModalOkBtn.className = danger ? 'button button-danger' : 'button button-primary';
        }
        if (confirmModalCancelBtn) confirmModalCancelBtn.textContent = cancelText;

        if (confirmModalIcon) {
            confirmModalIcon.className = `modal-icon-wrap ${iconType === 'danger' ? 'danger' : 'primary'}`;
            if (iconType === 'danger') {
                confirmModalIcon.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                `;
            } else {
                confirmModalIcon.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                `;
            }
        }

        confirmModal.classList.add('active');

        return new Promise((resolve) => {
            activeConfirmResolver = resolve;
        });
    }

    if (confirmModalOkBtn) {
        confirmModalOkBtn.addEventListener('click', () => closeConfirmModal(true));
    }
    if (confirmModalCancelBtn) {
        confirmModalCancelBtn.addEventListener('click', () => closeConfirmModal(false));
    }
    if (confirmModal) {
        confirmModal.addEventListener('click', (e) => {
            if (e.target === confirmModal) closeConfirmModal(false);
        });
    }

    // -------------------------------------------------------------
    // 4. Time Formatting & Truncation Helpers
    // -------------------------------------------------------------
    function formatTimeAgo(isoString) {
        if (!isoString) return 'recently';
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return 'recently';

        const now = new Date();
        const diffMs = now - date;
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSecs < 60) return 'just now';
        if (diffMins < 60) return `${diffMins} min ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;

        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function truncateUrl(url) {
        if (!url) return '';
        try {
            const parsed = new URL(url);
            const path = parsed.pathname;
            if (path.length > 25) {
                return '…' + path.slice(-22);
            }
            return path;
        } catch {
            return url.length > 25 ? '…' + url.slice(-22) : url;
        }
    }

    function formatBytes(bytes) {
        if (!bytes || isNaN(bytes) || bytes <= 0) return '';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        let val = Number(bytes);
        while (val >= 1024 && i < units.length - 1) {
            val /= 1024;
            i++;
        }
        return `${val < 10 && i > 0 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
    }

    // -------------------------------------------------------------
    // 5. Tree Rendering Engine
    // -------------------------------------------------------------
    const SVG_ICONS = {
        domainFolder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>`,
        nestedFolder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>`,
        image: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><circle cx="9" cy="9" r="1.6"/><path d="m20.5 15-5-5L5 20.5"/></svg>`,
        video: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3V9Z"/></svg>`,
        file: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function highlightText(text, query) {
        if (!query || !text) return escapeHtml(text);
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedQuery})`, 'gi');
        return escapeHtml(text).replace(regex, '<mark class="search-highlight">$1</mark>');
    }

    function renderTree(treeData, searchQuery = '') {
        if (!treeContainer) return;

        if (!treeData || treeData.length === 0) {
            treeContainer.innerHTML = `
                <div class="empty-tree-state">
                    <div class="empty-icon-wrap" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            <line x1="12" y1="11" x2="12" y2="17"></line>
                            <line x1="9" y1="14" x2="15" y2="14"></line>
                        </svg>
                    </div>
                    <h3 class="empty-title">No Media URLs Analyzed Yet</h3>
                    <p class="empty-desc">Paste any image, video, or GIF link into the box above to extract its directory structure.</p>
                </div>
            `;
            return;
        }

        const query = searchQuery.trim().toLowerCase();
        let html = '';

        function renderNode(node, currentDomain = '') {
            if (node.type === 'domain') {
                const domainName = node.name || '';
                const color = node.domain_color || 'violet';
                const domainType = node.domain_type || 'MEDIA SOURCE';
                const itemsCount = node.items_count || 0;
                const foldersCount = node.folders_count || 0;
                const timeText = formatTimeAgo(node.last_updated);

                let childrenHtml = '';
                if (node.children && node.children.length > 0) {
                    childrenHtml = node.children.map(ch => renderNode(ch, domainName)).join('');
                }

                return `
                    <details class="tree-domain" open>
                        <summary class="tree-row domain-row">
                            <span class="tree-chevron" aria-label="Toggle domain"></span>
                            <span class="folder-icon domain-folder ${color}-folder">
                                ${SVG_ICONS.domainFolder}
                            </span>
                            <span class="tree-name">
                                <strong>${highlightText(node.name, query)}</strong>
                                <small>${itemsCount} item${itemsCount !== 1 ? 's' : ''} <b>·</b> ${foldersCount} folder${foldersCount !== 1 ? 's' : ''}</small>
                            </span>
                            <span class="domain-type ${color}-label">${escapeHtml(domainType)}</span>
                            <span class="row-meta">${escapeHtml(timeText)}</span>
                            <span class="row-spacer"></span>
                        </summary>
                        ${childrenHtml}
                    </details>
                `;
            } else if (node.type === 'folder') {
                const filesCount = node.files_count || (node.children ? node.children.length : 0);
                const pathText = node.path || `/${node.name}/`;
                const timeText = formatTimeAgo(node.last_updated);

                // Collect all files in this folder for folder-level discovery
                function collectFolderUrls(fNode) {
                    const list = [];
                    function walk(n) {
                        if (!n) return;
                        if (n.type === 'file' && n.url) list.push(n.url);
                        if (n.children && Array.isArray(n.children)) n.children.forEach(walk);
                    }
                    walk(fNode);
                    return list;
                }
                const folderMediaUrls = collectFolderUrls(node);
                const folderKey = `${currentDomain}::${pathText}`;
                folderLookupMap.set(folderKey, folderMediaUrls);

                let childrenHtml = '';
                if (node.children && node.children.length > 0) {
                    childrenHtml = node.children.map(ch => renderNode(ch, currentDomain)).join('');
                }

                const magicBtnHtml = folderMediaUrls.length > 0
                    ? `<button type="button" class="folder-magic-btn" data-folder-key="${escapeHtml(folderKey)}" data-folder="${escapeHtml(pathText)}" data-domain="${escapeHtml(currentDomain)}" title="Scan this folder on host for missing media (✨ Folder Magic)" aria-label="Scan Folder for Missing Media">✨ Scan Folder</button>`
                    : '';

                return `
                    <details class="tree-folder" open>
                        <summary class="tree-row folder-row">
                            <span class="tree-chevron" aria-label="Toggle folder"></span>
                            <span class="folder-icon nested-folder">
                                ${SVG_ICONS.nestedFolder}
                            </span>
                            <span class="tree-name">
                                <div class="folder-title-row">
                                    <strong>${highlightText(node.name, query)}</strong>
                                    ${magicBtnHtml}
                                </div>
                                <small>${escapeHtml(pathText)}</small>
                            </span>
                            <span class="file-count">${filesCount} FILE${filesCount !== 1 ? 'S' : ''}</span>
                            <span class="row-meta">${escapeHtml(timeText)}</span>
                            <span class="row-spacer"></span>
                        </summary>
                        ${childrenHtml}
                    </details>
                `;
            } else if (node.type === 'file') {
                if (node.url) fileLookupMap.set(node.url, node);
                const ext = (node.extension || 'FILE').toUpperCase();
                const mType = node.media_type || 'image';
                const timeText = formatTimeAgo(node.last_updated || node.first_added);
                const truncated = truncateUrl(node.url);
                const meta = node.metadata || {};

                // Badges for enriched metadata (size, dimensions, CDN)
                let metaBadgesHtml = '';
                if (meta.size_bytes && !isNaN(meta.size_bytes) && Number(meta.size_bytes) > 0) {
                    metaBadgesHtml += `<span class="meta-badge size-badge" title="Size: ${Number(meta.size_bytes).toLocaleString()} bytes">${formatBytes(meta.size_bytes)}</span>`;
                }
                if (meta.dimensions && Array.isArray(meta.dimensions) && meta.dimensions.length === 2) {
                    metaBadgesHtml += `<span class="meta-badge dim-badge" title="Resolution: ${meta.dimensions[0]} × ${meta.dimensions[1]} px">${meta.dimensions[0]}×${meta.dimensions[1]}</span>`;
                }
                if (meta.cdn_provider) {
                    metaBadgesHtml += `<span class="meta-badge cdn-badge" title="CDN / Host: ${escapeHtml(meta.cdn_provider)}">${escapeHtml(meta.cdn_provider)}</span>`;
                }

                let iconHtml = SVG_ICONS.image;
                let iconClass = 'image-icon';
                let chipClass = 'image-chip';

                if (mType === 'gif' || ext === 'GIF') {
                    iconHtml = `<span>GIF</span>`;
                    iconClass = 'gif-icon';
                    chipClass = 'gif-chip';
                } else if (mType === 'video' || ['MP4', 'WEBM', 'MOV', 'M4V'].includes(ext)) {
                    iconHtml = SVG_ICONS.video;
                    iconClass = 'video-icon';
                    chipClass = 'video-chip';
                } else if (ext === 'WEBP') {
                    iconClass = 'image-icon';
                    chipClass = 'webp-chip';
                } else if (mType === 'other') {
                    iconHtml = SVG_ICONS.file;
                    iconClass = 'other-icon';
                    chipClass = 'other-chip';
                }

                const repeatsBadge = node.count > 1 
                    ? `<span class="duplicate-badge" title="Submitted ${node.count} times">↻ ${node.count}</span>` 
                    : `<span class="row-spacer"></span>`;

                const isTarget = lastUpdatedUrl && node.url === lastUpdatedUrl;
                const highlightStyle = isTarget ? 'style="background: #f0edff;"' : '';

                return `
                    <div class="file-row" ${highlightStyle} data-url="${escapeHtml(node.url)}">
                        <span class="tree-spacer"></span>
                        <span class="file-icon ${iconClass}">
                            ${iconHtml}
                        </span>
                        <span class="file-name">
                            <div class="file-title-row">
                                <a href="${escapeHtml(node.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(node.url)}">
                                    <strong>${highlightText(node.name, query)}</strong>
                                </a>
                                <button type="button" class="tree-magic-btn" data-url="${escapeHtml(node.url)}" title="Discover Sibling Files (✨ Magic Scanner)" aria-label="Discover Sibling Files">✨</button>
                            </div>
                            <div class="file-sub-row">
                                <small title="${escapeHtml(node.url)}">${escapeHtml(truncated)}</small>
                                ${metaBadgesHtml}
                            </div>
                        </span>
                        <span class="type-chip ${chipClass}">${escapeHtml(ext)}</span>
                        <span class="row-meta">${escapeHtml(timeText)}</span>
                        ${repeatsBadge}
                    </div>
                `;
            }
            return '';
        }

        // Apply search & media type filtering
        function filterNode(node) {
            const hasQuery = Boolean(query);
            const hasFilter = currentMediaTypeFilter !== 'all';

            if (node.type === 'file') {
                if (hasFilter && node.media_type !== currentMediaTypeFilter) {
                    return null;
                }
                if (!hasQuery) return node;

                const nameMatches = node.name && node.name.toLowerCase().includes(query);
                const pathMatches = node.path && node.path.toLowerCase().includes(query);
                const urlMatches = node.url && node.url.toLowerCase().includes(query);
                const extMatches = node.extension && node.extension.toLowerCase().includes(query);
                return (nameMatches || urlMatches || extMatches) ? node : null;
            }

            if (node.children) {
                const filteredChildren = node.children
                    .map(filterNode)
                    .filter(Boolean);

                const nameMatches = hasQuery && node.name && node.name.toLowerCase().includes(query);
                const pathMatches = hasQuery && node.path && node.path.toLowerCase().includes(query);

                if (filteredChildren.length > 0) {
                    return {
                        ...node,
                        children: filteredChildren
                    };
                }
                if (!hasFilter && (nameMatches || pathMatches)) {
                    return {
                        ...node,
                        children: []
                    };
                }
            }

            return null;
        }

        const filteredTree = (query || currentMediaTypeFilter !== 'all') 
            ? treeData.map(filterNode).filter(Boolean) 
            : treeData;

        if (filteredTree.length === 0) {
            treeContainer.innerHTML = `
                <div class="empty-tree-state">
                    <h3 class="empty-title">No Matching Files</h3>
                    <p class="empty-desc">No entries match your search query or media filter.</p>
                </div>
            `;
            updateFoldersToggleState();
            return;
        }

        html = filteredTree.map(renderNode).join('');
        treeContainer.innerHTML = html;
        updateFoldersToggleState();
    }

    // Helper: extract all file leaves from hierarchical tree data with folder path
    function extractFilesFromTree(nodes, query = '') {
        const files = [];
        const q = query ? query.trim().toLowerCase() : '';

        function walk(node, domain = null, folderPath = '/') {
            if (!node) return;
            const currentDomain = node.type === 'domain' ? node.name : domain;
            let currentFolderPath = folderPath;
            if (node.type === 'folder') {
                currentFolderPath = node.path || (folderPath.endsWith('/') ? `${folderPath}${node.name}/` : `${folderPath}/${node.name}/`);
            }

            if (node.type === 'file') {
                if (node.url) fileLookupMap.set(node.url, node);
                if (currentMediaTypeFilter !== 'all' && node.media_type !== currentMediaTypeFilter) {
                    return;
                }
                if (!q || 
                    (node.name && node.name.toLowerCase().includes(q)) ||
                    (node.url && node.url.toLowerCase().includes(q)) ||
                    (node.extension && node.extension.toLowerCase().includes(q)) ||
                    (currentDomain && currentDomain.toLowerCase().includes(q)) ||
                    (currentFolderPath && currentFolderPath.toLowerCase().includes(q))
                ) {
                    files.push({ ...node, domain: currentDomain, folderPath: currentFolderPath });
                }
                return;
            }

            if (node.children && Array.isArray(node.children)) {
                for (const child of node.children) {
                    walk(child, currentDomain, currentFolderPath);
                }
            }
        }

        if (Array.isArray(nodes)) {
            for (const root of nodes) {
                walk(root);
            }
        }
        return files;
    }

    function getFileTimestamp(file) {
        const raw = file.last_updated || file.first_added;
        if (!raw) return 0;
        const t = new Date(raw).getTime();
        return isNaN(t) ? 0 : t;
    }

    function renderMediaCard(file, searchQuery = '') {
        const ext = (file.extension || 'FILE').toUpperCase();
        const mType = file.media_type || 'image';
        const meta = file.metadata || {};
        const timeText = formatTimeAgo(file.last_updated || file.first_added);
        const isVideo = mType === 'video' || ['MP4', 'WEBM', 'MOV', 'M4V', 'MKV', 'AVI', 'OGV'].includes(ext);
        const isImage = !isVideo && (mType === 'image' || mType === 'gif' || ['JPG', 'JPEG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'SVG', 'ICO', 'BMP'].includes(ext));
        const thumbUrl = `/api/thumbnail?url=${encodeURIComponent(file.url)}&size=320`;

        let thumbContent = '';
        if (isImage) {
            thumbContent = `
                <div class="thumb-skeleton" aria-hidden="true"></div>
                <img class="media-card-thumb lazy-thumb" 
                     data-src="${escapeHtml(thumbUrl)}" 
                     data-ext="${escapeHtml(ext)}"
                     alt="${escapeHtml(file.name)}" 
                     loading="lazy">
            `;
        } else if (isVideo) {
            thumbContent = `
                <div class="thumb-skeleton" aria-hidden="true"></div>
                <video class="media-card-video-thumb lazy-video"
                       data-src="${escapeHtml(file.url)}"
                       data-thumb="${escapeHtml(thumbUrl)}"
                       preload="metadata"
                       muted
                       playsinline
                       crossorigin="anonymous"
                       title="${escapeHtml(file.name)}">
                </video>
                <div class="media-card-video-badge" title="Hover video to play preview">
                    <span class="video-badge-icon">
                        <svg class="play-icon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="m9 7 8 5-8 5V7Z"/></svg>
                        <span class="playing-bars">
                            <i></i><i></i><i></i>
                        </span>
                    </span>
                    <span class="video-badge-ext">${escapeHtml(ext)}</span>
                    <span class="video-badge-tip">Hover to play</span>
                </div>
            `;
        } else {
            thumbContent = `
                <div class="media-card-fallback">
                    ${SVG_ICONS.file}
                    <span>${escapeHtml(ext)}</span>
                </div>
            `;
        }

        let metaBadgesHtml = '';
        if (meta.size_bytes && !isNaN(meta.size_bytes) && Number(meta.size_bytes) > 0) {
            metaBadgesHtml += `<span class="meta-badge size-badge" title="Size: ${Number(meta.size_bytes).toLocaleString()} bytes">${formatBytes(meta.size_bytes)}</span>`;
        }
        if (meta.dimensions && Array.isArray(meta.dimensions) && meta.dimensions.length === 2) {
            metaBadgesHtml += `<span class="meta-badge dim-badge" title="Resolution: ${meta.dimensions[0]} × ${meta.dimensions[1]} px">${meta.dimensions[0]}×${meta.dimensions[1]}</span>`;
        }

        const repeatsBadge = file.count > 1 
            ? `<span class="duplicate-badge" title="Submitted ${file.count} times">↻ ${file.count}</span>` 
            : '';

        return `
            <div class="media-card" data-url="${escapeHtml(file.url)}">
                <div class="media-card-thumb-wrap">
                    ${thumbContent}
                    <div class="media-card-badge-top">
                        <span class="type-chip ${mType === 'video' ? 'video-chip' : (ext === 'WEBP' ? 'webp-chip' : (ext === 'GIF' ? 'gif-chip' : 'image-chip'))}">${escapeHtml(ext)}</span>
                        <button type="button" class="tree-magic-btn" data-url="${escapeHtml(file.url)}" title="Discover Sibling Files (✨ Magic Scanner)">✨</button>
                        ${repeatsBadge}
                    </div>
                </div>
                <div class="media-card-body">
                    <div class="media-card-title" title="${escapeHtml(file.name)}">
                        <a href="${escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer">${highlightText(file.name, searchQuery)}</a>
                    </div>
                    <div class="media-card-domain" title="${escapeHtml(file.domain || file.url)}">
                        ${escapeHtml(file.domain || '')}
                    </div>
                    <div class="media-card-meta">
                        <div class="media-card-badges">
                            ${metaBadgesHtml}
                        </div>
                        <span>${escapeHtml(timeText)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    // Grid View Renderer - Grouped by Folder Path and Chronologically Sorted
    function renderGridView(treeData, searchQuery = '') {
        if (!treeContainer) return;

        if (!treeData || treeData.length === 0) {
            treeContainer.innerHTML = `
                <div class="empty-tree-state">
                    <div class="empty-icon-wrap" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                            <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                            <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                            <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
                            <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
                        </svg>
                    </div>
                    <h3 class="empty-title">No Media URLs In Gallery</h3>
                    <p class="empty-desc">Paste any image, video, or GIF link into the box above to see visual previews.</p>
                </div>
            `;
            return;
        }

        const files = extractFilesFromTree(treeData, searchQuery);

        if (files.length === 0) {
            treeContainer.innerHTML = `
                <div class="empty-tree-state">
                    <h3 class="empty-title">No Matching Media</h3>
                    <p class="empty-desc">No entries match your search query "<strong>${escapeHtml(searchQuery)}</strong>".</p>
                </div>
            `;
            return;
        }

        // Group files by domain and folder path
        const folderMap = new Map();
        for (const file of files) {
            const domain = file.domain || 'unknown';
            const folderPath = file.folderPath || '/';
            const key = `${domain}::${folderPath}`;
            if (!folderMap.has(key)) {
                folderMap.set(key, {
                    key,
                    domain,
                    folderPath,
                    items: [],
                    latestTimestamp: 0
                });
            }
            const group = folderMap.get(key);
            group.items.push(file);
            const ts = getFileTimestamp(file);
            if (ts > group.latestTimestamp) {
                group.latestTimestamp = ts;
            }
        }

        // Tier 1 Sort: Sort media items inside each folder chronologically (newest to oldest)
        const folderGroups = Array.from(folderMap.values());
        for (const group of folderGroups) {
            group.items.sort((a, b) => getFileTimestamp(b) - getFileTimestamp(a));
        }

        // Tier 2 Sort: Sort folder groups themselves chronologically (latest activity first)
        folderGroups.sort((a, b) => b.latestTimestamp - a.latestTimestamp);

        // Render each folder group with structured header and grid
        const folderSectionsHtml = folderGroups.map(group => {
            const cardsHtml = group.items.map(f => renderMediaCard(f, searchQuery)).join('');
            const cleanPath = group.folderPath === '/' ? 'Root' : group.folderPath.replace(/^\/|\/$/g, '');
            const latestTimeAgo = group.latestTimestamp > 0 
                ? formatTimeAgo(new Date(group.latestTimestamp).toISOString()) 
                : '';

            const gridFolderKey = `${group.domain}::${group.folderPath}`;
            const gridUrls = group.items.map(it => it.url).filter(Boolean);
            folderLookupMap.set(gridFolderKey, gridUrls);

            const gridMagicBtnHtml = gridUrls.length > 0
                ? `<button type="button" class="grid-folder-magic-btn" data-folder-key="${escapeHtml(gridFolderKey)}" data-folder="${escapeHtml(group.folderPath)}" data-domain="${escapeHtml(group.domain)}" title="Scan this folder on host for missing media (✨ Folder Magic)">✨ Scan Folder</button>`
                : '';

            return `
                <section class="grid-folder-section" data-folder-key="${escapeHtml(group.key)}">
                    <header class="grid-folder-header">
                        <div class="grid-folder-title-wrap">
                            <span class="grid-folder-icon" aria-hidden="true">
                                ${SVG_ICONS.nestedFolder}
                            </span>
                            <div class="grid-folder-path-info">
                                <span class="grid-folder-domain">${escapeHtml(group.domain)}</span>
                                <span class="grid-folder-divider">/</span>
                                <span class="grid-folder-path" title="${escapeHtml(group.folderPath)}">${escapeHtml(cleanPath)}</span>
                            </div>
                        </div>
                        <div class="grid-folder-meta">
                            <span class="grid-folder-count-badge">${group.items.length} ${group.items.length === 1 ? 'file' : 'files'}</span>
                            ${latestTimeAgo ? `<span class="grid-folder-time-badge" title="Latest activity in this folder: ${escapeHtml(new Date(group.latestTimestamp).toLocaleString())}">Updated ${escapeHtml(latestTimeAgo)}</span>` : ''}
                            ${gridMagicBtnHtml}
                        </div>
                    </header>
                    <div class="media-grid">
                        ${cardsHtml}
                    </div>
                </section>
            `;
        }).join('');

        treeContainer.innerHTML = `<div class="grid-view-container">${folderSectionsHtml}</div>`;
        observeLazyThumbnails();
    }

    // -------------------------------------------------------------
    // Clusters Rendering Engine & Deduplication Actions
    // -------------------------------------------------------------
    async function loadClustersData(autoRender = true) {
        try {
            const localUrls = LocalStorageDB.getUrls();
            // Use POST with client-side localStorage URLs to guarantee resilience against server dyno wipes
            const response = await authFetch('/api/clusters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: localUrls })
            });
            if (!response.ok) return;
            const data = await response.json();
            if (data.status === 'success') {
                rawClustersData = data;
                const totalClusters = (data.summary && data.summary.total_clusters) || 0;
                if (clustersBadge) {
                    if (totalClusters > 0) {
                        clustersBadge.textContent = totalClusters;
                        clustersBadge.style.display = 'inline-block';
                    } else {
                        clustersBadge.style.display = 'none';
                    }
                }
                if (currentViewMode === 'clusters' && autoRender) {
                    renderClustersView(rawClustersData);
                }
            }
        } catch (err) {
            console.debug('Error loading clusters:', err);
        }
    }

    async function deleteUrls(urls, successToastTitle = 'Duplicates Removed') {
        if (!urls || urls.length === 0) return;
        try {
            // Delete from client-side persistent store first
            const deletedCount = LocalStorageDB.deleteUrls(urls);

            // Also notify backend to keep mirror in sync if server is online
            authFetch('/api/urls', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls })
            }).catch(e => console.debug('Silent server mirror delete error:', e));

            showToast(successToastTitle, `Deleted ${deletedCount} duplicate variant URL${deletedCount !== 1 ? 's' : ''}.`, 'success');
            await loadTreeData();
            await loadClustersData(true);
        } catch (err) {
            console.error('Delete error:', err);
            showToast('Deletion Error', 'Failed to remove URLs.', 'error');
        }
    }

    function renderClustersView(data) {
        if (!treeContainer) return;

        try {
            if (!data || !data.clusters || data.clusters.length === 0) {
            treeContainer.innerHTML = `
                <div class="empty-tree-state">
                    <div class="empty-icon-wrap">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                    </div>
                    <h3 class="empty-title">No Duplicates Found</h3>
                    <p class="empty-desc">Your library is completely clean! Every media file is unique in filename, resolution, and appearance. When duplicate links or lower-resolution copies are added, they will appear here for easy 1-click cleanup.</p>
                </div>
            `;
            if (footerCount) footerCount.textContent = '0 duplicate groups';
            return;
        }

        const clusters = data.clusters;
        const summary = data.summary || {};
        const totalClusters = summary.total_clusters || clusters.length;
        const totalVariants = summary.total_variants || 0;
        const savingsBytes = summary.potential_savings_bytes || 0;

        if (footerCount) {
            footerCount.textContent = `${totalClusters} duplicate group${totalClusters !== 1 ? 's' : ''}`;
        }

        const explainerHtml = `
            <div class="clusters-explainer">
                <svg class="clusters-explainer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <div class="clusters-explainer-text">
                    <strong>How duplicate resolution works:</strong> media index detected identical or multi-resolution versions of the same media. The highest quality copy is marked as <strong>★ Best Version</strong>. You can resolve each group by keeping the best copy, deleting individual variants, or choosing <strong>Keep All</strong> to preserve every file.
                </div>
            </div>
        `;

        const heroHtml = `
            <div class="clusters-hero">
                <div class="clusters-hero-stats">
                    <div class="clusters-stat-pill">
                        <span class="clusters-stat-num">${totalClusters}</span>
                        <span class="clusters-stat-label">Duplicate Groups</span>
                    </div>
                    <div class="clusters-stat-pill">
                        <span class="clusters-stat-num">${totalVariants}</span>
                        <span class="clusters-stat-label">Redundant Copies</span>
                    </div>
                    <div class="clusters-stat-pill">
                        <span class="clusters-stat-num highlight-savings">${savingsBytes > 0 ? formatBytes(savingsBytes) : '0 B'}</span>
                        <span class="clusters-stat-label">Potential Storage Savings</span>
                    </div>
                </div>
                <div class="clusters-hero-actions">
                    <button type="button" class="clean-all-btn" id="clean-all-clusters-btn" title="Delete all redundant copies across all groups, keeping only the best originals">
                        <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        <span>Resolve All Duplicates (Delete ${totalVariants})</span>
                    </button>
                </div>
            </div>
        `;

        function renderClusterItemRow(item, isCanonical) {
            if (!item) return '';
            const meta = item.metadata || {};
            const rawName = item.name || item.filename || (item.url ? item.url.split('/').pop().split('?')[0] : 'media-file');
            const ext = (rawName.includes('.') ? rawName.split('.').pop() : (item.extension || 'IMG')).toUpperCase();
            const thumbUrl = `/api/thumbnail?url=${encodeURIComponent(item.url || '')}`;
            
            const width = item.width || (meta.dimensions && meta.dimensions[0]);
            const height = item.height || (meta.dimensions && meta.dimensions[1]);
            const sizeBytes = item.size_bytes ?? item.content_length ?? meta.size_bytes ?? meta.content_length;

            const isVideoItem = mType === 'video' || ['MP4', 'WEBM', 'MOV', 'M4V', 'MKV', 'AVI', 'OGV'].includes(ext);
            let metaBadgesHtml = '';
            if (width && height) {
                metaBadgesHtml += `<span class="meta-badge dim-badge">${width}×${height}</span>`;
            }
            if (sizeBytes && !isNaN(sizeBytes) && Number(sizeBytes) > 0) {
                metaBadgesHtml += `<span class="meta-badge size-badge">${formatBytes(sizeBytes)}</span>`;
            }

            const badgeHtml = isCanonical 
                ? `<span class="badge-canonical">★ Best Version (Keep)</span>`
                : `<span class="badge-duplicate">Duplicate Variant</span>`;

            let qualityLabel = '';
            if (isCanonical) {
                if (width && height) {
                    qualityLabel = `<span class="cluster-item-quality is-winner">Best Resolution (${width}×${height})</span>`;
                } else if (sizeBytes) {
                    qualityLabel = `<span class="cluster-item-quality is-winner">Highest Quality (${formatBytes(sizeBytes)})</span>`;
                } else {
                    qualityLabel = `<span class="cluster-item-quality is-winner">Primary Master</span>`;
                }
            } else {
                if (width && height) {
                    qualityLabel = `<span class="cluster-item-quality">Resolution: ${width}×${height}</span>`;
                } else if (sizeBytes) {
                    qualityLabel = `<span class="cluster-item-quality">File Size: ${formatBytes(sizeBytes)}</span>`;
                } else {
                    qualityLabel = `<span class="cluster-item-quality">Duplicate Variant</span>`;
                }
            }

            const actionHtml = isCanonical
                ? `${qualityLabel}`
                : `
                    ${qualityLabel}
                    <button type="button" class="delete-single-variant-btn" data-url="${escapeHtml(item.url || '')}" title="Delete this duplicate copy from library">
                        <svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        <span>Delete</span>
                    </button>
                `;

            const thumbElementHtml = isVideoItem
                ? `<video class="cluster-video-thumb lazy-video" data-src="${escapeHtml(item.url || '')}" data-thumb="${escapeHtml(thumbUrl)}" preload="metadata" muted playsinline></video>`
                : `<img class="lazy-thumb" data-src="${escapeHtml(thumbUrl)}" data-ext="${escapeHtml(ext)}" alt="${escapeHtml(rawName)}" loading="lazy">`;

            return `
                <div class="cluster-item-row ${isCanonical ? 'is-canonical' : ''}" data-url="${escapeHtml(item.url || '')}">
                    <div class="cluster-item-thumb">
                        ${thumbElementHtml}
                    </div>
                    <div class="cluster-item-info">
                        <div class="cluster-item-title-row">
                            ${badgeHtml}
                            <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(rawName)}">${escapeHtml(rawName)}</a>
                        </div>
                        <div class="cluster-item-meta-row">
                            <span class="domain-type violet-label">${escapeHtml(item.domain || '')}</span>
                            ${metaBadgesHtml}
                            <small title="${escapeHtml(item.url || '')}">${escapeHtml(truncateUrl(item.url || ''))}</small>
                        </div>
                    </div>
                    <div class="cluster-item-actions">
                        ${actionHtml}
                    </div>
                </div>
            `;
        }

        const clusterCardsHtml = clusters.map(cluster => {
            const items = Array.isArray(cluster.items) ? cluster.items : [];
            const canonical = cluster.canonical || items.find(it => it.is_canonical) || items[0] || {};
            const duplicates = cluster.duplicates || items.filter(it => !it.is_canonical) || (items.length > 1 ? items.slice(1) : []);
            const savings = cluster.potential_savings_bytes ?? cluster.savings_bytes ?? 0;
            const confidence = cluster.confidence || 'medium';
            
            // Human-readable match badge & explanation
            let matchBadgeText = 'Resolution Variant';
            let matchExplanation = 'Same image with different sizes or CDN mirrors';
            if (confidence === 'high') {
                matchBadgeText = 'Exact Match';
                matchExplanation = 'Identical file content and size across links';
            } else if (confidence === 'low') {
                matchBadgeText = 'Visual Match';
                matchExplanation = 'Visually identical pictures detected via image fingerprint';
            }

            const canonicalRowHtml = renderClusterItemRow(canonical, true);
            const duplicatesRowsHtml = duplicates.map(d => renderClusterItemRow(d, false)).join('');

            return `
                <div class="cluster-card" data-cluster-id="${escapeHtml(cluster.cluster_id || '')}">
                    <div class="cluster-header">
                        <div class="cluster-header-left">
                            <span class="cluster-confidence-badge confidence-${escapeHtml(confidence)}">${escapeHtml(matchBadgeText)}</span>
                            <span class="cluster-reason-text">${escapeHtml(matchExplanation)}</span>
                        </div>
                        <div class="cluster-header-right">
                            ${savings > 0 ? `<span class="cluster-savings-pill">Save ~${formatBytes(savings)}</span>` : ''}
                            <button type="button" class="keep-both-btn" data-cluster-id="${escapeHtml(cluster.cluster_id || '')}" data-item-count="${items.length || (duplicates.length + 1)}" title="Keep all ${items.length || (duplicates.length + 1)} copies in this group and dismiss from duplicates list">
                                <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                <span>${(items.length || (duplicates.length + 1)) === 2 ? 'Keep Both' : `Keep All (${items.length || (duplicates.length + 1)})`}</span>
                            </button>
                            <button type="button" class="clean-cluster-btn" data-cluster-id="${escapeHtml(cluster.cluster_id || '')}" title="Keep best quality version and delete ${duplicates.length} redundant ${duplicates.length === 1 ? 'copy' : 'copies'} in this group">
                                <svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                                <span>Keep Best Only (Delete ${duplicates.length})</span>
                            </button>
                        </div>
                    </div>
                    <div class="cluster-items">
                        ${canonicalRowHtml}
                        ${duplicatesRowsHtml}
                    </div>
                </div>
            `;
        }).join('');

        treeContainer.innerHTML = `
            <div class="clusters-view">
                ${explainerHtml}
                ${heroHtml}
                ${clusterCardsHtml}
            </div>
        `;

        observeLazyThumbnails();

        // Wire up Clean All Variants button
        const cleanAllBtn = treeContainer.querySelector('#clean-all-clusters-btn');
        if (cleanAllBtn) {
            cleanAllBtn.addEventListener('click', async () => {
                const allDuplicateUrls = [];
                clusters.forEach(c => {
                    const cItems = Array.isArray(c.items) ? c.items : [];
                    const cDups = c.duplicates || cItems.filter(it => !it.is_canonical) || [];
                    cDups.forEach(d => {
                        if (d && d.url) allDuplicateUrls.push(d.url);
                    });
                });
                const uniqueUrls = Array.from(new Set(allDuplicateUrls));
                if (uniqueUrls.length === 0) {
                    showToast('No Duplicates', 'No redundant copies found to clean.', 'info');
                    return;
                }
                const confirmed = await showConfirmModal({
                    title: 'Resolve All Duplicates',
                    body: `Resolve all ${clusters.length} duplicate groups by keeping the best version of each and permanently deleting ${uniqueUrls.length} redundant ${uniqueUrls.length === 1 ? 'copy' : 'copies'}?`,
                    confirmText: `Delete ${uniqueUrls.length} ${uniqueUrls.length === 1 ? 'Copy' : 'Copies'}`,
                    danger: true,
                    iconType: 'danger'
                });
                if (confirmed) {
                    deleteUrls(uniqueUrls, 'All Duplicates Cleaned');
                }
            });
        }

        // Wire up per-cluster Clean Variants buttons
        treeContainer.querySelectorAll('.clean-cluster-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const clusterId = btn.getAttribute('data-cluster-id');
                const cluster = clusters.find(c => c.cluster_id === clusterId);
                if (!cluster) return;
                const cItems = Array.isArray(cluster.items) ? cluster.items : [];
                const cDups = cluster.duplicates || cItems.filter(it => !it.is_canonical) || [];
                const urls = cDups.map(d => d.url).filter(Boolean);
                const uniqueUrls = Array.from(new Set(urls));
                if (uniqueUrls.length === 0) return;
                const confirmed = await showConfirmModal({
                    title: 'Keep Best Version Only',
                    body: `Keep the highest quality version and delete ${uniqueUrls.length} duplicate ${uniqueUrls.length === 1 ? 'copy' : 'copies'} from this group?`,
                    confirmText: `Delete ${uniqueUrls.length} ${uniqueUrls.length === 1 ? 'Copy' : 'Copies'}`,
                    danger: true,
                    iconType: 'danger'
                });
                if (confirmed) {
                    deleteUrls(uniqueUrls, 'Group Cleaned');
                }
            });
        });

        // Wire up per-cluster Keep Both (Dismiss) buttons
        treeContainer.querySelectorAll('.keep-both-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const clusterId = btn.getAttribute('data-cluster-id');
                if (!clusterId) return;

                btn.disabled = true;
                try {
                    const response = await authFetch('/api/clusters/dismiss', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cluster_id: clusterId })
                    });
                    const res = await response.json();
                    if (response.ok && res.status === 'success') {
                        const itemCount = parseInt(btn.getAttribute('data-item-count') || '2', 10);
                        const toastMsg = itemCount === 2 
                            ? 'Both files were preserved and dismissed from duplicate suggestions.' 
                            : `All ${itemCount} files were preserved and dismissed from duplicate suggestions.`;
                        showToast('Group Preserved', toastMsg, 'success');
                        await loadClustersData(true);
                    } else {
                        showToast('Error', res.message || 'Could not preserve duplicate group.', 'error');
                        btn.disabled = false;
                    }
                } catch (err) {
                    console.error('Keep both error:', err);
                    showToast('Network Error', 'Failed to communicate with server.', 'error');
                    btn.disabled = false;
                }
            });
        });

        // Wire up single duplicate variant delete buttons
        treeContainer.querySelectorAll('.delete-single-variant-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const url = btn.getAttribute('data-url');
                if (!url) return;
                const confirmed = await showConfirmModal({
                    title: 'Delete Duplicate Copy',
                    body: `Delete this duplicate copy from your library?\n${url}`,
                    confirmText: 'Delete Copy',
                    danger: true,
                    iconType: 'danger'
                });
                if (confirmed) {
                    deleteUrls([url], 'Duplicate Removed');
                }
            });
        });
        } catch (err) {
            console.error('Error rendering clusters view:', err);
            treeContainer.innerHTML = `
                <div class="empty-tree-state">
                    <h3 class="empty-title">Error Displaying Duplicates</h3>
                    <p class="empty-desc">An error occurred while displaying duplicate groups: ${escapeHtml(err.message)}</p>
                </div>
            `;
        }
    }

    // IntersectionObserver for Lazy-Loaded Thumbnails
    let gridObserver = null;

    function observeLazyThumbnails() {
        if (gridObserver) {
            gridObserver.disconnect();
            gridObserver = null;
        }

        const lazyImages = treeContainer ? Array.from(treeContainer.querySelectorAll('img.lazy-thumb')) : [];
        const lazyVideos = treeContainer ? Array.from(treeContainer.querySelectorAll('video.lazy-video')) : [];
        if (!lazyImages.length && !lazyVideos.length) return;

        function loadImg(img) {
            const src = img.getAttribute('data-src');
            if (!src || img.src) return;

            img.src = src;

            img.onload = () => {
                img.classList.add('thumb-loaded');
                const skeleton = img.previousElementSibling;
                if (skeleton && skeleton.classList.contains('thumb-skeleton')) {
                    skeleton.style.display = 'none';
                }
            };

            img.onerror = () => {
                const wrap = img.closest('.media-card-thumb-wrap');
                const ext = img.getAttribute('data-ext') || 'IMG';
                if (wrap) {
                    wrap.innerHTML = `
                        <div class="media-card-fallback">
                            ${SVG_ICONS.image}
                            <span>${escapeHtml(ext)}</span>
                        </div>
                    `;
                }
            };
        }

        function loadVid(vid) {
            const src = vid.getAttribute('data-src');
            if (!src || vid.src) return;

            vid.src = src;

            vid.onloadeddata = () => {
                vid.classList.add('thumb-loaded');
                const skeleton = vid.previousElementSibling;
                if (skeleton && skeleton.classList.contains('thumb-skeleton')) {
                    skeleton.style.display = 'none';
                }
                // Seek to representative frame (2s)
                try {
                    vid.currentTime = 2;
                } catch {}
            };

            vid.onerror = () => {
                const thumb = vid.getAttribute('data-thumb');
                const wrap = vid.closest('.media-card-thumb-wrap');
                const card = vid.closest('.media-card');
                const ext = (card && card.querySelector('.type-chip') ? card.querySelector('.type-chip').textContent : 'VIDEO').toUpperCase();
                
                // Fallback to backend thumbnail (which generates aesthetic placeholder if ffmpeg missing)
                if (thumb && !vid.dataset.fellBack) {
                    vid.dataset.fellBack = 'true';
                    const fallbackImg = document.createElement('img');
                    fallbackImg.className = 'media-card-thumb thumb-loaded';
                    fallbackImg.src = thumb;
                    fallbackImg.alt = 'Video Preview';
                    vid.parentNode.replaceChild(fallbackImg, vid);
                    const skeleton = wrap ? wrap.querySelector('.thumb-skeleton') : null;
                    if (skeleton) skeleton.style.display = 'none';
                } else if (wrap) {
                    wrap.innerHTML = `
                        <div class="media-card-fallback">
                            ${SVG_ICONS.video}
                            <span>${escapeHtml(ext)} Video</span>
                        </div>
                    `;
                }
            };

            // Interactive hover scrubbing for video preview cards
            const parentCard = vid.closest('.media-card');
            if (parentCard && !parentCard.dataset.videoBound) {
                parentCard.dataset.videoBound = 'true';
                parentCard.addEventListener('mouseenter', () => {
                    if (vid.readyState >= 2) {
                        vid.play().then(() => {
                            parentCard.classList.add('video-is-playing');
                        }).catch(() => {});
                    } else {
                        // If metadata/frame still buffering, mark ready to play as soon as data arrives
                        const onReady = () => {
                            vid.play().then(() => parentCard.classList.add('video-is-playing')).catch(() => {});
                            vid.removeEventListener('loadeddata', onReady);
                        };
                        vid.addEventListener('loadeddata', onReady);
                    }
                });
                parentCard.addEventListener('mouseleave', () => {
                    vid.pause();
                    parentCard.classList.remove('video-is-playing');
                    try { vid.currentTime = 2; } catch {}
                });
            }
        }

        const allLazy = [...lazyImages, ...lazyVideos];

        if (typeof IntersectionObserver !== 'undefined') {
            gridObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const target = entry.target;
                        if (target.tagName.toLowerCase() === 'img') {
                            loadImg(target);
                        } else if (target.tagName.toLowerCase() === 'video') {
                            loadVid(target);
                        }
                        observer.unobserve(target);
                    }
                });
            }, { rootMargin: '200px 0px' });

            allLazy.forEach(el => gridObserver.observe(el));
        } else {
            // Direct load fallback
            lazyImages.forEach(loadImg);
            lazyVideos.forEach(loadVid);
        }
    }

    // -------------------------------------------------------------
    // Floating Hover Preview Panel Controller
    // -------------------------------------------------------------
    let hoverShowTimer = null;
    let hoverHideTimer = null;
    let currentPreviewUrl = null;

    function queueHoverPreview(node, anchorEl, delay = 220) {
        clearTimeout(hoverHideTimer);
        if (currentPreviewUrl === node.url && floatingPreviewCard && floatingPreviewCard.classList.contains('active')) {
            return;
        }
        clearTimeout(hoverShowTimer);
        hoverShowTimer = setTimeout(() => showHoverPreview(node, anchorEl), delay);
    }

    function cancelHoverPreview() {
        clearTimeout(hoverShowTimer);
        clearTimeout(hoverHideTimer);
        hoverHideTimer = setTimeout(() => hideHoverPreview(), 180);
    }

    function hideHoverPreview() {
        clearTimeout(hoverShowTimer);
        clearTimeout(hoverHideTimer);
        if (previewCardVideo) {
            previewCardVideo.pause();
            previewCardVideo.removeAttribute('src');
            previewCardVideo.load();
            previewCardVideo.style.display = 'none';
        }
        if (floatingPreviewCard) {
            floatingPreviewCard.classList.remove('active');
            floatingPreviewCard.setAttribute('aria-hidden', 'true');
        }
        currentPreviewUrl = null;
    }

    function showHoverPreview(node, anchorEl) {
        if (!floatingPreviewCard || !node || !anchorEl) return;
        currentPreviewUrl = node.url;

        const ext = (node.extension || 'FILE').toUpperCase();
        const mType = node.media_type || 'image';
        const meta = node.metadata || {};
        const isImg = mType === 'image' || mType === 'gif' || ['JPG', 'JPEG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'SVG'].includes(ext);

        // Header Title & Extension Chip
        if (previewCardName) previewCardName.textContent = node.name || 'Media Asset';
        if (previewCardExt) {
            previewCardExt.textContent = ext;
            previewCardExt.className = `type-chip ${mType === 'video' ? 'video-chip' : (ext === 'WEBP' ? 'webp-chip' : (ext === 'GIF' ? 'gif-chip' : 'image-chip'))}`;
        }

        // Metadata grid
        if (previewMetaSize) {
            previewMetaSize.textContent = meta.size_bytes ? formatBytes(meta.size_bytes) : '—';
        }
        if (previewMetaDim) {
            if (meta.dimensions && Array.isArray(meta.dimensions) && meta.dimensions.length === 2) {
                previewMetaDim.textContent = `${meta.dimensions[0]} × ${meta.dimensions[1]} px`;
                if (previewDimBadge) {
                    previewDimBadge.textContent = `${meta.dimensions[0]}×${meta.dimensions[1]}`;
                    previewDimBadge.style.display = 'block';
                }
            } else {
                previewMetaDim.textContent = '—';
                if (previewDimBadge) previewDimBadge.style.display = 'none';
            }
        }
        if (previewMetaCdn) {
            previewMetaCdn.textContent = meta.cdn_provider || '—';
        }
        if (previewMetaMime) {
            previewMetaMime.textContent = meta.mime_type || (node.extension ? `image/${node.extension}` : '—');
        }

        // Action links
        if (previewOpenLink) {
            previewOpenLink.href = node.url;
        }
        if (previewCopyBtn) {
            previewCopyBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(node.url);
                    showToast('Copied', 'Media URL copied to clipboard!', 'success', 2000);
                } catch {
                    showToast('Copy Failed', 'Clipboard access not permitted.', 'error');
                }
            };
        }
        const previewDiscoverBtn = document.getElementById('preview-discover-btn');
        if (previewDiscoverBtn) {
            previewDiscoverBtn.onclick = () => {
                cancelHoverPreview();
                openSiblingDiscoveryModal(node.url);
            };
        }

        // Media Thumbnail Preview
        const isVid = mType === 'video' || ['MP4', 'WEBM', 'MOV', 'M4V', 'MKV', 'AVI', 'OGV'].includes(ext);
        if (previewCardVideo) {
            previewCardVideo.pause();
            previewCardVideo.removeAttribute('src');
            previewCardVideo.load();
            previewCardVideo.style.display = 'none';
        }

        if (isImg && !isVid) {
            if (previewCardFallback) previewCardFallback.style.display = 'none';
            if (previewThumbSkeleton) previewThumbSkeleton.style.display = 'block';
            if (previewCardImg) {
                previewCardImg.style.display = 'block';
                previewCardImg.classList.remove('loaded');
                const thumbUrl = `/api/thumbnail?url=${encodeURIComponent(node.url)}&size=480`;
                previewCardImg.src = thumbUrl;
                previewCardImg.onload = () => {
                    previewCardImg.classList.add('loaded');
                    if (previewThumbSkeleton) previewThumbSkeleton.style.display = 'none';
                };
                previewCardImg.onerror = () => {
                    previewCardImg.style.display = 'none';
                    if (previewThumbSkeleton) previewThumbSkeleton.style.display = 'none';
                    if (previewCardFallback) {
                        previewCardFallback.style.display = 'flex';
                        previewCardFallback.innerHTML = `${SVG_ICONS.image}<span>${escapeHtml(ext)}</span>`;
                    }
                };
            }
        } else if (isVid) {
            if (previewCardImg) previewCardImg.style.display = 'none';
            if (previewCardFallback) previewCardFallback.style.display = 'none';
            if (previewThumbSkeleton) previewThumbSkeleton.style.display = 'block';
            if (previewCardVideo) {
                previewCardVideo.style.display = 'block';
                previewCardVideo.classList.remove('loaded');
                previewCardVideo.src = node.url;
                previewCardVideo.onloadeddata = () => {
                    previewCardVideo.classList.add('loaded');
                    if (previewThumbSkeleton) previewThumbSkeleton.style.display = 'none';
                    try { previewCardVideo.currentTime = 2; } catch {}
                };
                previewCardVideo.onerror = () => {
                    previewCardVideo.style.display = 'none';
                    if (previewThumbSkeleton) previewThumbSkeleton.style.display = 'none';
                    if (previewCardFallback) {
                        previewCardFallback.style.display = 'flex';
                        previewCardFallback.innerHTML = `${SVG_ICONS.video}<span>${escapeHtml(ext)} Video</span>`;
                    }
                };
            }
        } else {
            if (previewCardImg) previewCardImg.style.display = 'none';
            if (previewThumbSkeleton) previewThumbSkeleton.style.display = 'none';
            if (previewDimBadge) previewDimBadge.style.display = 'none';
            if (previewCardFallback) {
                previewCardFallback.style.display = 'flex';
                previewCardFallback.innerHTML = `${SVG_ICONS.file}<span>${escapeHtml(ext)}</span>`;
            }
        }

        // Smart positioning relative to anchor and viewport bounds
        const rect = anchorEl.getBoundingClientRect();
        const cardWidth = 310;
        const cardHeight = 330;

        let left, top;

        if (currentViewMode === 'tree') {
            // Position safely to the right margin so it NEVER covers tree rows
            if (rect.right + cardWidth + 24 <= window.innerWidth) {
                left = rect.right + 12;
            } else {
                left = window.innerWidth - cardWidth - 24;
            }
            top = rect.top - 60;
            if (top + cardHeight > window.innerHeight - 16) {
                top = window.innerHeight - cardHeight - 16;
            }
            if (top < 16) top = 16;
        } else {
            // Grid view: center horizontally relative to card, place below or above
            left = rect.left + (rect.width - cardWidth) / 2;
            top = rect.bottom + 8;
            if (top + cardHeight > window.innerHeight - 16) {
                top = rect.top - cardHeight - 8;
            }
            if (top < 16) top = 16;
            if (left + cardWidth > window.innerWidth - 16) {
                left = window.innerWidth - cardWidth - 16;
            }
            if (left < 16) left = 16;
        }

        floatingPreviewCard.style.top = `${Math.round(top)}px`;
        floatingPreviewCard.style.left = `${Math.round(left)}px`;
        floatingPreviewCard.classList.add('active');
        floatingPreviewCard.setAttribute('aria-hidden', 'false');
    }

    // -------------------------------------------------------------
    // View Switching and Dispatch
    function setViewMode(mode) {
        if (mode !== 'tree' && mode !== 'grid' && mode !== 'clusters') mode = 'tree';
        currentViewMode = mode;
        try {
            localStorage.setItem(VIEW_MODE_KEY, mode);
        } catch {}

        hideHoverPreview();

        if (mode === 'tree' && gridObserver) {
            gridObserver.disconnect();
            gridObserver = null;
        }

        if (viewTreeBtn) viewTreeBtn.classList.toggle('active', mode === 'tree');
        if (viewGridBtn) viewGridBtn.classList.toggle('active', mode === 'grid');
        if (viewClustersBtn) viewClustersBtn.classList.toggle('active', mode === 'clusters');
        if (librarySection) {
            librarySection.classList.toggle('is-grid-mode', mode === 'grid');
            librarySection.classList.toggle('is-clusters-mode', mode === 'clusters');
        }
        if (tableHead) tableHead.style.display = (mode === 'grid' || mode === 'clusters') ? 'none' : '';

        if (librarySubtitle) {
            if (mode === 'grid') {
                librarySubtitle.textContent = 'Visual gallery of analyzed media files';
            } else if (mode === 'clusters') {
                librarySubtitle.textContent = 'Review duplicate media, keep the best version, and free up space';
            } else {
                librarySubtitle.textContent = 'Analyzed files arranged by source and path';
            }
        }

        renderActiveView();
    }

    function renderActiveView() {
        if (currentViewMode === 'grid') {
            renderGridView(rawTreeData, currentSearchQuery);
        } else if (currentViewMode === 'clusters') {
            if (!rawClustersData) {
                loadClustersData(true);
            } else {
                renderClustersView(rawClustersData);
            }
        } else {
            renderTree(rawTreeData, currentSearchQuery);
        }
    }

    // -------------------------------------------------------------
    // 6. Fetch & Refresh Tree Data (LocalStorage-first with server fallback)
    // -------------------------------------------------------------
    let hasAttemptedInitialSync = false;

    async function loadTreeData() {
        try {
            // First check local persistent storage
            let localUrls = LocalStorageDB.getUrls();
            const localKeys = Object.keys(localUrls);

            // One-time automatic migration fallback: if localStorage is empty on initial boot,
            // query backend database to import any existing server records into localStorage
            if (!hasAttemptedInitialSync && localKeys.length === 0) {
                hasAttemptedInitialSync = true;
                try {
                    const serverExport = await authFetch('/api/export');
                    if (serverExport.ok) {
                        const dump = await serverExport.json();
                        if (dump && dump.urls && Object.keys(dump.urls).length > 0) {
                            LocalStorageDB.importData(dump);
                            localUrls = LocalStorageDB.getUrls();
                            console.log('Migrated server database into persistent browser localStorage.');
                        }
                    }
                } catch (migrationErr) {
                    console.debug('Initial server sync note:', migrationErr);
                }
            } else {
                hasAttemptedInitialSync = true;
            }

            // Build hierarchical visual tree client-side from persistent localStorage
            const localTreeResult = buildTreeFromLocalEntries(localUrls);
            rawTreeData = localTreeResult.tree || [];
            const stats = localTreeResult.stats || {};

            // Update Overview Stats
            const totalUrls = stats.total_urls || 0;
            const totalSources = stats.total_sources || rawTreeData.length || 0;
            const duplicateSubs = stats.duplicate_submissions || 0;
            const hasRecords = totalUrls > 0;

            if (statTotalMedia) statTotalMedia.textContent = totalUrls;
            if (statSources) statSources.textContent = totalSources;
            if (statRepeats) statRepeats.textContent = duplicateSubs;
            if (treeCountBadge) treeCountBadge.textContent = totalUrls;
            if (footerCount) footerCount.textContent = `${totalUrls} item${totalUrls !== 1 ? 's' : ''}`;

            // Dynamically disable or enable actions based on whether records exist
            if (exportBtn) exportBtn.disabled = !hasRecords;
            if (resetDbBtn) resetDbBtn.disabled = !hasRecords;
            if (expandAllBtn) expandAllBtn.disabled = !hasRecords;
            if (collapseAllBtn) collapseAllBtn.disabled = !hasRecords;
            if (toggleFoldersBtn) toggleFoldersBtn.disabled = !hasRecords;
            if (treeSearchInput) {
                treeSearchInput.disabled = !hasRecords;
                if (!hasRecords) {
                    treeSearchInput.value = '';
                    if (clearSearchBtn) clearSearchBtn.style.display = 'none';
                }
            }

            updateMediaTypeCounts();
            renderActiveView();
            loadClustersData(false);
        } catch (err) {
            console.error('Error loading tree data:', err);
            showToast('Sync Error', 'Could not load directory data.', 'error');
        }
    }

    // -------------------------------------------------------------
    // 7. URL Submission Handling
    // -------------------------------------------------------------
    async function submitUrl(urlText) {
        if (!urlText || !urlText.trim()) {
            showToast('Invalid Input', 'Please enter a valid URL address.', 'error');
            return;
        }

        const cleanUrl = urlText.trim();
        submitBtn.disabled = true;
        if (captureStatus) captureStatus.textContent = 'Analyzing URL structure...';

        try {
            const response = await authFetch('/api/urls', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: cleanUrl })
            });

            const data = await response.json();

            if (response.ok && data.status === 'success') {
                lastUpdatedUrl = cleanUrl;
                urlInput.value = '';
                if (clearUrlBtn) clearUrlBtn.style.display = 'none';

                // Save immediately into persistent browser localStorage
                LocalStorageDB.addOrIncrement(data.entry);

                if (data.is_duplicate) {
                    showToast(
                        'Duplicate Caught',
                        `Seen ${data.count} times. Frequency count incremented.`,
                        'duplicate'
                    );
                } else {
                    showToast(
                        'URL Analyzed',
                        `Added "${data.entry.filename}" to folder structure.`,
                        'success'
                    );
                }

                await loadTreeData();
                if (captureStatus) captureStatus.textContent = 'Structure updated successfully';

                // Silent background enrichment: probe size, MIME, dimensions, and CDN
                authFetch('/api/enrich', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: cleanUrl, update_db: true })
                })
                    .then(res => res.json())
                    .then(enrichData => {
                        if (enrichData && enrichData.status === 'success' && enrichData.metadata) {
                            LocalStorageDB.updateMetadata(cleanUrl, enrichData.metadata);
                            loadTreeData();
                        }
                    })
                    .catch(err => {
                        console.debug('Background enrichment silent error:', err);
                    });
            } else {
                showToast('Submission Failed', data.message || 'Could not analyze URL.', 'error');
                if (captureStatus) captureStatus.textContent = data.message || 'Error parsing URL';
            }
        } catch (err) {
            console.error('Submission error:', err);
            showToast('Network Error', 'Failed to communicate with server.', 'error');
            if (captureStatus) captureStatus.textContent = 'Network communication failure';
        } finally {
            submitBtn.disabled = false;
        }
    }

    if (urlForm) {
        urlForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitUrl(urlInput.value);
        });
    }

    // Toggle clear button on input typing
    if (urlInput && clearUrlBtn) {
        urlInput.addEventListener('input', () => {
            clearUrlBtn.style.display = urlInput.value.trim() ? 'grid' : 'none';
        });

        clearUrlBtn.addEventListener('click', () => {
            urlInput.value = '';
            clearUrlBtn.style.display = 'none';
            urlInput.focus();
        });
    }

    // Quick Paste from Clipboard
    if (pasteBtn) {
        pasteBtn.addEventListener('click', async () => {
            try {
                if (navigator.clipboard && navigator.clipboard.readText) {
                    const text = await navigator.clipboard.readText();
                    if (text && text.trim()) {
                        urlInput.value = text.trim();
                        if (clearUrlBtn) clearUrlBtn.style.display = 'grid';
                        urlInput.focus();
                        } else {
                        showToast('Clipboard Empty', 'No text found in clipboard.', 'info');
                    }
                } else {
                    urlInput.focus();
                }
            } catch {
                urlInput.focus();
            }
        });
    }

    // -------------------------------------------------------------
    // 8. Live Search & Tree / Grid Controls
    // -------------------------------------------------------------
    if (viewTreeBtn) {
        viewTreeBtn.addEventListener('click', () => setViewMode('tree'));
    }

    if (viewGridBtn) {
        viewGridBtn.addEventListener('click', () => setViewMode('grid'));
    }

    if (viewClustersBtn) {
        viewClustersBtn.addEventListener('click', () => {
            setViewMode('clusters');
            loadClustersData(true);
        });
    }

    if (treeSearchInput) {
        treeSearchInput.addEventListener('input', (e) => {
            currentSearchQuery = e.target.value;
            if (clearSearchBtn) {
                clearSearchBtn.style.display = currentSearchQuery ? 'grid' : 'none';
            }
            renderActiveView();
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            if (treeSearchInput) {
                treeSearchInput.value = '';
                currentSearchQuery = '';
                clearSearchBtn.style.display = 'none';
                renderActiveView();
                treeSearchInput.focus();
            }
        });
    }

    // -------------------------------------------------------------
    // Toolbar Show/Hide Actions: Smart Folders, Focus Mode, Filters
    // -------------------------------------------------------------

    // Media Type Quick Filters
    function updateMediaTypeCounts() {
        const counts = { image: 0, video: 0, gif: 0 };
        function walk(node) {
            if (node.type === 'file') {
                const m = node.media_type || 'image';
                if (counts[m] !== undefined) counts[m]++;
            }
            if (node.children) node.children.forEach(walk);
        }
        if (Array.isArray(rawTreeData)) rawTreeData.forEach(walk);

        if (filterCountImage) filterCountImage.textContent = counts.image;
        if (filterCountVideo) filterCountVideo.textContent = counts.video;
        if (filterCountGif) filterCountGif.textContent = counts.gif;
    }

    function setMediaTypeFilter(filterType) {
        currentMediaTypeFilter = filterType;
        if (mediaTypeFilters) {
            mediaTypeFilters.querySelectorAll('.filter-pill').forEach(pill => {
                pill.classList.toggle('active', pill.getAttribute('data-filter') === filterType);
            });
        }

        if (activeFilterBadge) {
            if (filterType !== 'all') {
                const label = filterType === 'image' ? 'Images' : (filterType === 'video' ? 'Videos' : 'GIFs');
                activeFilterBadge.textContent = `${label} Only ✕`;
                activeFilterBadge.title = 'Click to clear filter';
                activeFilterBadge.style.display = 'inline-block';
            } else {
                activeFilterBadge.style.display = 'none';
            }
        }

        renderActiveView();
    }

    if (mediaTypeFilters) {
        mediaTypeFilters.addEventListener('click', (e) => {
            const pill = e.target.closest('.filter-pill');
            if (!pill) return;
            const filterType = pill.getAttribute('data-filter') || 'all';
            setMediaTypeFilter(filterType);
        });
    }

    if (activeFilterBadge) {
        activeFilterBadge.addEventListener('click', () => {
            setMediaTypeFilter('all');
            });
    }

    // Smart Show/Hide All Folders Toggle
    function updateFoldersToggleState() {
        if (!treeContainer || !toggleFoldersBtn) return;
        const allDetails = treeContainer.querySelectorAll('details');
        if (!allDetails.length) {
            toggleFoldersBtn.disabled = true;
            return;
        }
        toggleFoldersBtn.disabled = false;
        const closedCount = Array.from(allDetails).filter(d => !d.open).length;
        const iconSvg = toggleFoldersBtn.querySelector('.icon-toggle-folders');
        if (closedCount > 0) {
            if (toggleFoldersText) toggleFoldersText.textContent = 'Expand All';
            toggleFoldersBtn.title = `Show all folders (${closedCount} currently closed) — Shift+E`;
            if (iconSvg) {
                iconSvg.innerHTML = `<polyline points="7 13 12 18 17 13"></polyline><polyline points="7 6 12 11 17 6"></polyline>`;
            }
        } else {
            if (toggleFoldersText) toggleFoldersText.textContent = 'Collapse All';
            toggleFoldersBtn.title = `Hide all folders (all currently open) — Shift+E`;
            if (iconSvg) {
                iconSvg.innerHTML = `<polyline points="6 17 11 12 6 7"></polyline><polyline points="13 17 18 12 13 7"></polyline>`;
            }
        }
    }

    if (toggleFoldersBtn) {
        toggleFoldersBtn.addEventListener('click', () => {
            const allDetails = treeContainer.querySelectorAll('details');
            if (!allDetails.length) return;
            const hasClosed = Array.from(allDetails).some(d => !d.open);
            allDetails.forEach(d => d.open = hasClosed);
            updateFoldersToggleState();
            
        });
    }

    if (treeContainer) {
        treeContainer.addEventListener('toggle', (e) => {
            if (e.target && e.target.tagName === 'DETAILS') {
                updateFoldersToggleState();
            }
        }, true);
    }

    // Focus Mode: Show / Hide Top URL Analyzer & Hero Card
    function setFocusMode(enable, silent = false) {
        isFocusMode = Boolean(enable);
        try {
            localStorage.setItem(FOCUS_MODE_KEY, isFocusMode ? '1' : '0');
        } catch {}

        if (pageWrap) {
            pageWrap.classList.toggle('is-focus-mode', isFocusMode);
        }
        if (toggleFocusModeBtn) {
            toggleFocusModeBtn.classList.toggle('is-active', isFocusMode);
            const expandIcon = toggleFocusModeBtn.querySelector('.focus-icon-expand');
            const collapseIcon = toggleFocusModeBtn.querySelector('.focus-icon-collapse');
            if (expandIcon) expandIcon.style.display = isFocusMode ? 'none' : 'block';
            if (collapseIcon) collapseIcon.style.display = isFocusMode ? 'block' : 'none';
            if (focusModeText) {
                focusModeText.textContent = isFocusMode ? 'Exit Focus' : 'Focus';
            }
            toggleFocusModeBtn.title = isFocusMode 
                ? 'Show URL analyzer card (Shift+F)' 
                : 'Hide URL analyzer card to maximize folder view (Shift+F)';
        }

        
    }

    if (toggleFocusModeBtn) {
        toggleFocusModeBtn.addEventListener('click', () => {
            setFocusMode(!isFocusMode);
        });
    }

    // Expand All / Collapse All (Legacy compatibility)
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => {
            const detailsElements = treeContainer.querySelectorAll('details');
            detailsElements.forEach(d => d.open = true);
            updateFoldersToggleState();
            });
    }

    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => {
            const detailsElements = treeContainer.querySelectorAll('details');
            detailsElements.forEach(d => d.open = false);
            updateFoldersToggleState();
            });
    }

    // Floating Hover Preview Event Delegation
    if (floatingPreviewCard) {
        floatingPreviewCard.addEventListener('mouseenter', () => clearTimeout(hoverHideTimer));
        floatingPreviewCard.addEventListener('mouseleave', () => cancelHoverPreview());
    }

    if (treeContainer) {
        treeContainer.addEventListener('mouseover', (e) => {
            const fileIconTrigger = e.target.closest('.file-icon');
            const rowOrCard = e.target.closest('.file-row, .media-card');
            if (!rowOrCard) return;

            const url = rowOrCard.getAttribute('data-url');
            if (!url) return;
            const node = fileLookupMap.get(url);
            if (!node) return;

            if (fileIconTrigger) {
                // Hovered directly over file icon: prompt fast reveal
                queueHoverPreview(node, fileIconTrigger, 120);
            } else if (currentViewMode === 'grid') {
                // In Grid view, do not show hover popover if hovering the card's thumbnail/video
                // so inline scrubbing & playback are unobstructed. Only preview when hovering title/meta or eye trigger.
                const isMediaThumb = e.target.closest('.media-card-thumb-wrap');
                if (!isMediaThumb) {
                    queueHoverPreview(node, rowOrCard, 350);
                } else {
                    cancelHoverPreview();
                }
            } else {
                // Tree view: deliberate hover delay, positioned to the side
                queueHoverPreview(node, rowOrCard, 350);
            }
        });

        treeContainer.addEventListener('mouseout', (e) => {
            const rowOrCard = e.target.closest('.file-row, .media-card');
            if (!rowOrCard) return;
            if (rowOrCard.contains(e.relatedTarget)) return;
            cancelHoverPreview();
        });

        treeContainer.addEventListener('click', (e) => {
            const magicTrigger = e.target.closest('.tree-magic-btn');
            if (magicTrigger) {
                e.preventDefault();
                e.stopPropagation();
                const url = magicTrigger.getAttribute('data-url');
                if (url) {
                    cancelHoverPreview();
                    openSiblingDiscoveryModal(url, magicTrigger);
                }
                return;
            }

            const folderMagicTrigger = e.target.closest('.folder-magic-btn, .grid-folder-magic-btn');
            if (folderMagicTrigger) {
                e.preventDefault();
                e.stopPropagation();
                const folderKey = folderMagicTrigger.getAttribute('data-folder-key');
                const folderPath = folderMagicTrigger.getAttribute('data-folder') || '/';
                const domain = folderMagicTrigger.getAttribute('data-domain') || '';
                const urls = folderLookupMap.get(folderKey) || [];
                if (urls.length > 0) {
                    cancelHoverPreview();
                    openFolderDiscoveryModal(folderPath, domain, urls, folderMagicTrigger);
                } else {
                    showToast('Folder Empty', 'No media URLs in this folder to scan.', 'info');
                }
                return;
            }
        });
    }

    window.addEventListener('scroll', () => hideHoverPreview(), { passive: true });

    // -------------------------------------------------------------
    // 9. Export & Import Backup
    // -------------------------------------------------------------
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const localUrls = LocalStorageDB.getUrls();
            const totalCount = Object.keys(localUrls).length;
            if (totalCount === 0) {
                showToast('No Records', 'Nothing to export. Add some URLs first.', 'info');
                return;
            }

            try {
                // Instant client-side download from persistent localStorage
                const exportPayload = LocalStorageDB.exportData();
                const now = new Date();
                const dateStr = now.toISOString().slice(0, 10);
                const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
                const filename = `media_index_export_${dateStr}_${timeStr}.json`;

                const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();

                showToast('Export Complete', `Saved ${totalCount} records as ${filename}`, 'success');
            } catch (err) {
                console.error('Export error:', err);
                showToast('Export Error', 'Failed to generate backup JSON.', 'error');
            }
        });
    }

    // -------------------------------------------------------------
    // 9. Bulk Import Pipeline (JSON, CSV, XML, TXT with Preview)
    // -------------------------------------------------------------
    let pendingImportFile = null;

    function openImportPreviewModal(file, previewData) {
        pendingImportFile = file;
        if (importModalSubtitle) {
            importModalSubtitle.textContent = `${file.name} • ${(previewData.format || 'file').toUpperCase()}`;
        }
        if (importTotalFound) {
            importTotalFound.textContent = previewData.total_found ?? (previewData.urls ? previewData.urls.length : 0);
        }
        if (importNewCount) {
            importNewCount.textContent = previewData.new_count ?? 0;
        }
        if (importDupCount) {
            importDupCount.textContent = previewData.duplicate_count ?? 0;
        }
        if (confirmImportText) {
            confirmImportText.textContent = `Import All (${previewData.total_found ?? 0} URLs)`;
        }

        if (importPreviewList) {
            importPreviewList.innerHTML = '';
            const urls = previewData.urls || [];
            if (urls.length === 0) {
                importPreviewList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--sub); font-size: 12px;">No preview items available.</div>';
            } else {
                urls.forEach(item => {
                    const row = document.createElement('div');
                    row.className = 'import-preview-item';

                    const urlSpan = document.createElement('span');
                    urlSpan.className = 'import-preview-url';
                    urlSpan.textContent = typeof item === 'string' ? item : (item.url || '');
                    urlSpan.title = urlSpan.textContent;

                    const tagSpan = document.createElement('span');
                    const isDup = typeof item === 'object' && item.is_duplicate;
                    tagSpan.className = `import-tag ${isDup ? 'tag-dup' : 'tag-new'}`;
                    tagSpan.textContent = isDup ? 'DUPLICATE' : 'NEW';

                    row.appendChild(urlSpan);
                    row.appendChild(tagSpan);
                    importPreviewList.appendChild(row);
                });

                if (previewData.total_found && previewData.total_found > urls.length) {
                    const moreDiv = document.createElement('div');
                    moreDiv.style.cssText = 'padding: 6px; text-align: center; color: var(--sub); font-size: 11px; font-style: italic;';
                    moreDiv.textContent = `... and ${previewData.total_found - urls.length} more URLs`;
                    importPreviewList.appendChild(moreDiv);
                }
            }
        }

        if (importPreviewModal) {
            importPreviewModal.classList.add('active');
        }
    }

    function closeImportPreviewModal() {
        if (importPreviewModal) {
            importPreviewModal.classList.remove('active');
        }
        pendingImportFile = null;
        if (importFileInput) importFileInput.value = '';
    }

    async function handleImportFile(file) {
        if (!file) return;

        const allowedExts = ['.json', '.csv', '.xml', '.txt'];
        const nameLower = file.name.toLowerCase();
        const hasValidExt = allowedExts.some(ext => nameLower.endsWith(ext));

        if (!hasValidExt && !['application/json', 'text/csv', 'application/xml', 'text/xml', 'text/plain'].includes(file.type)) {
            showToast('Unsupported File', 'Please select a .json, .csv, .xml, or .txt file.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await authFetch('/api/import?preview=true', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (response.ok && (data.status === 'preview' || data.status === 'success')) {
                openImportPreviewModal(file, data);
            } else {
                showToast('Import Error', data.message || 'Could not parse import file.', 'error');
            }
        } catch (err) {
            console.error('Import preview error:', err);
            showToast('Import Error', 'Failed to inspect file.', 'error');
        }
    }

    if (importBtn && importFileInput) {
        importBtn.addEventListener('click', () => {
            importFileInput.value = '';
            importFileInput.click();
        });

        importFileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) handleImportFile(file);
        });
    }

    if (cancelImportBtn) {
        cancelImportBtn.addEventListener('click', closeImportPreviewModal);
    }

    if (confirmImportBtn) {
        confirmImportBtn.addEventListener('click', async () => {
            if (!pendingImportFile) {
                closeImportPreviewModal();
                return;
            }

            confirmImportBtn.disabled = true;
            if (confirmImportText) confirmImportText.textContent = 'Importing...';

            // Fast-path client-side import for JSON files
            if (pendingImportFile.name.toLowerCase().endsWith('.json')) {
                try {
                    const text = await pendingImportFile.text();
                    const jsonPayload = JSON.parse(text);
                    const importResult = LocalStorageDB.importData(jsonPayload);
                    closeImportPreviewModal();
                    showToast(
                        'Import Successful',
                        `Imported ${importResult.imported} URLs (${importResult.merged} merged).`,
                        'success'
                    );
                    await loadTreeData();

                    // Background sync mirror with server
                    authFetch('/api/import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(jsonPayload)
                    }).catch(e => console.debug('Silent server mirror import note:', e));
                } catch (jsonErr) {
                    console.error('Client JSON import error:', jsonErr);
                    showToast('Import Failed', 'Invalid JSON backup format.', 'error');
                } finally {
                    confirmImportBtn.disabled = false;
                    if (confirmImportText) confirmImportText.textContent = 'Import All URLs';
                }
                return;
            }

            // CSV, XML, TXT parsing via server parser
            const formData = new FormData();
            formData.append('file', pendingImportFile);

            try {
                const response = await authFetch('/api/import', {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();
                closeImportPreviewModal();

                if (response.ok && data.status === 'success') {
                    // Pull updated mirror from server into localStorage
                    try {
                        const sExport = await authFetch('/api/export');
                        if (sExport.ok) {
                            const exportData = await sExport.json();
                            if (exportData && exportData.urls) {
                                LocalStorageDB.importData(exportData);
                            }
                        }
                    } catch {}

                    const imported = data.imported_count ?? data.imported ?? 0;
                    const merged = data.duplicate_count ?? data.merged ?? 0;
                    showToast(
                        'Import Successful',
                        `Imported ${imported} URLs (${merged} duplicates merged).`,
                        'success'
                    );
                    await loadTreeData();
                } else {
                    showToast('Import Failed', data.message || 'Error executing import.', 'error');
                }
            } catch (err) {
                console.error('Import execution error:', err);
                closeImportPreviewModal();
                showToast('Import Error', 'Failed to complete import.', 'error');
            } finally {
                confirmImportBtn.disabled = false;
                if (confirmImportText) confirmImportText.textContent = 'Import All URLs';
            }
        });
    }

    // Global Drag & Drop Handlers
    if (dragDropOverlay) {
        let dragCounter = 0;

        window.addEventListener('dragenter', (e) => {
            if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
                dragCounter++;
                dragDropOverlay.classList.add('active');
            }
        });

        window.addEventListener('dragleave', (e) => {
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                dragDropOverlay.classList.remove('active');
            }
        });

        window.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        dragDropOverlay.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        dragDropOverlay.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            dragDropOverlay.classList.remove('active');

            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleImportFile(e.dataTransfer.files[0]);
            }
        });
    }

    if (importPreviewModal) {
        importPreviewModal.addEventListener('click', (e) => {
            if (e.target === importPreviewModal) closeImportPreviewModal();
        });
    }

    // -------------------------------------------------------------
    // 10. Reset Database Modal
    // -------------------------------------------------------------
    function openResetModal() {
        if (!rawTreeData || rawTreeData.length === 0) {
            showToast('Database Empty', 'No records to clear.', 'info');
            return;
        }
        if (resetModal) resetModal.classList.add('active');
    }

    function closeResetModal() {
        if (resetModal) resetModal.classList.remove('active');
    }

    if (resetDbBtn) resetDbBtn.addEventListener('click', openResetModal);
    if (cancelResetBtn) cancelResetBtn.addEventListener('click', closeResetModal);

    if (confirmResetBtn) {
        confirmResetBtn.addEventListener('click', async () => {
            closeResetModal();
            try {
                // Clear persistent client-side storage
                LocalStorageDB.clear();

                // Also notify server mirror
                authFetch('/api/clear', { method: 'POST' }).catch(e => console.debug('Silent mirror reset note:', e));

                showToast('Database Reset', 'All stored URLs have been cleared.', 'success');
                await loadTreeData();
            } catch (err) {
                console.error('Reset error:', err);
                showToast('Reset Error', 'Failed to reset database.', 'error');
            }
        });
    }

    // -------------------------------------------------------------
    // Keyboard Shortcuts & Escape Key Handling
    // -------------------------------------------------------------
    document.addEventListener('keydown', (e) => {
        const activeEl = document.activeElement;
        const isTyping = activeEl && (
            activeEl.tagName === 'INPUT' || 
            activeEl.tagName === 'TEXTAREA' || 
            activeEl.isContentEditable
        );

        // Escape key handling across components
        if (e.key === 'Escape') {
            // 0. Close Floating Preview Card if active
            if (floatingPreviewCard && floatingPreviewCard.classList.contains('active')) {
                hideHoverPreview();
                return;
            }

            // 1. Close Confirmation Modal if active
            if (confirmModal && confirmModal.classList.contains('active')) {
                closeConfirmModal(false);
                return;
            }

            // 2. Close Modal if active
            if (importPreviewModal && importPreviewModal.classList.contains('active')) {
                closeImportPreviewModal();
                return;
            }
            if (resetModal && resetModal.classList.contains('active')) {
                closeResetModal();
                return;
            }

            // 2. Clear & blur main URL input
            if (activeEl === urlInput) {
                if (urlInput.value) {
                    urlInput.value = '';
                    if (clearUrlBtn) clearUrlBtn.style.display = 'none';
                } else {
                    urlInput.blur();
                }
                return;
            }

            // 3. Clear & blur search input
            if (activeEl === treeSearchInput) {
                if (treeSearchInput.value) {
                    treeSearchInput.value = '';
                    currentSearchQuery = '';
                    if (clearSearchBtn) clearSearchBtn.style.display = 'none';
                    renderActiveView();
                } else {
                    treeSearchInput.blur();
                }
                return;
            }
        }

        // Shortcut: Toggle View Mode (Shift+T for Tree, Shift+G for Grid, Shift+C for Clusters)
        if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !isTyping) {
            if (e.key === 'T' || e.key === 't') {
                e.preventDefault();
                setViewMode('tree');
                return;
            }
            if (e.key === 'G' || e.key === 'g') {
                e.preventDefault();
                setViewMode('grid');
                return;
            }
            if (e.key === 'C' || e.key === 'c') {
                e.preventDefault();
                setViewMode('clusters');
                loadClustersData(true);
                return;
            }
            if (e.key === 'E' || e.key === 'e') {
                e.preventDefault();
                if (toggleFoldersBtn && !toggleFoldersBtn.disabled) {
                    toggleFoldersBtn.click();
                }
                return;
            }
            if (e.key === 'F' || e.key === 'f') {
                e.preventDefault();
                if (toggleFocusModeBtn) {
                    toggleFocusModeBtn.click();
                }
                return;
            }
        }

        // Shortcut: Focus main URL entry textbox (Alt+U)
        if (e.altKey && (e.key === 'u' || e.key === 'U')) {
            e.preventDefault();
            if (urlInput) {
                urlInput.focus();
                urlInput.select();
            }
            return;
        }

        // Shortcut: Submit URL when Enter is pressed inside the URL input (non-empty)
        if (e.key === 'Enter' && document.activeElement === urlInput) {
            if (urlInput.value.trim()) {
                e.preventDefault();
                submitUrl(urlInput.value);
            }
            return;
        }

        // Shortcut: Focus main URL entry textbox (Press '/')
        if (e.key === '/' && !isTyping && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (urlInput) {
                urlInput.focus();
                urlInput.select();
            }
            return;
        }

        // Shortcut: Focus tree search input (Ctrl+F or F3)
        if ((e.key === 'F3' || (e.key === 'f' && e.ctrlKey && !e.metaKey)) && !e.altKey) {
            e.preventDefault();
            if (treeSearchInput && !treeSearchInput.disabled) {
                treeSearchInput.focus();
                treeSearchInput.select();
            }
            return;
        }
    });

    if (resetModal) {
        resetModal.addEventListener('click', (e) => {
            if (e.target === resetModal) closeResetModal();
        });
    }

    // -------------------------------------------------------------
    // Magic Sibling Discovery Lab Controller
    // -------------------------------------------------------------
    const discoveryModal = document.getElementById('discovery-modal');
    const discoveryModalTitle = document.getElementById('discovery-modal-title');
    const discoveryModalSubtitle = document.getElementById('discovery-modal-subtitle');
    const discoveryTargetLabel = document.getElementById('discovery-target-label');
    const discoverySeedUrl = document.getElementById('discovery-seed-url');
    const discoveryPatternBadge = document.getElementById('discovery-pattern-badge');
    const discoveryStatusBadge = document.getElementById('discovery-status-badge');
    const discoveryLoadingState = document.getElementById('discovery-loading-state');
    const discoveryLoadingMsg = document.getElementById('discovery-loading-msg');
    const discoveryEmptyState = document.getElementById('discovery-empty-state');
    const discoveryEmptyTitle = document.getElementById('discovery-empty-title');
    const discoveryEmptyDesc = document.getElementById('discovery-empty-desc');
    const discoveryResultsContainer = document.getElementById('discovery-results-container');
    const discoveryVerifiedCount = document.getElementById('discovery-verified-count');
    const discoveryNewCount = document.getElementById('discovery-new-count');
    const discoveryGrid = document.getElementById('discovery-grid');
    const discoverySelectNewBtn = document.getElementById('discovery-select-new-btn');
    const discoverySelectAllBtn = document.getElementById('discovery-select-all-btn');
    const discoveryClearSelBtn = document.getElementById('discovery-clear-sel-btn');
    const discoveryBtnNewCount = document.getElementById('discovery-btn-new-count');
    const discoveryBtnAllCount = document.getElementById('discovery-btn-all-count');
    const discoveryFooterCount = document.getElementById('discovery-footer-count');
    const discoveryIngestBtn = document.getElementById('discovery-ingest-btn');
    const discoveryIngestText = document.getElementById('discovery-ingest-text');
    const closeDiscoveryBtn = document.getElementById('close-discovery-btn');
    const discoveryCancelBtn = document.getElementById('discovery-cancel-btn');

    let currentDiscoveredSiblings = [];
    const selectedSiblingUrls = new Set();

    function closeDiscoveryModal() {
        if (discoveryModal) {
            discoveryModal.classList.remove('active');
        }
        currentDiscoveredSiblings = [];
        selectedSiblingUrls.clear();
    }

    if (closeDiscoveryBtn) closeDiscoveryBtn.addEventListener('click', closeDiscoveryModal);
    if (discoveryCancelBtn) discoveryCancelBtn.addEventListener('click', closeDiscoveryModal);
    if (discoveryModal) {
        discoveryModal.addEventListener('click', (e) => {
            if (e.target === discoveryModal) closeDiscoveryModal();
        });
    }

    function syncDiscoveryFilterButtons() {
        const totalSelected = selectedSiblingUrls.size;
        const totalItems = currentDiscoveredSiblings.length;
        const newItems = currentDiscoveredSiblings.filter(s => !s.in_library);
        const totalNew = newItems.length;

        if (totalItems === 0 || totalSelected === 0) {
            if (discoverySelectNewBtn) discoverySelectNewBtn.classList.remove('active');
            if (discoverySelectAllBtn) discoverySelectAllBtn.classList.remove('active');
            return;
        }

        const isAllSelected = totalSelected === totalItems;
        let isOnlyNewSelected = false;
        if (totalNew > 0 && totalNew < totalItems && totalSelected === totalNew) {
            isOnlyNewSelected = newItems.every(s => selectedSiblingUrls.has(s.url));
        }

        if (discoverySelectAllBtn) {
            discoverySelectAllBtn.classList.toggle('active', isAllSelected);
        }
        if (discoverySelectNewBtn) {
            discoverySelectNewBtn.classList.toggle('active', !isAllSelected && isOnlyNewSelected);
        }
    }

    function updateDiscoverySelectionCounts() {
        const totalSelected = selectedSiblingUrls.size;
        const totalItems = currentDiscoveredSiblings.length;
        const newItems = currentDiscoveredSiblings.filter(s => !s.in_library);
        const totalNew = newItems.length;

        // Smart Adaptive Button Visibility:
        // When all discovered items are new (totalNew === totalItems) or none are new,
        // hide "Select New" because "Select All" already serves this purpose.
        if (discoverySelectNewBtn) {
            discoverySelectNewBtn.style.display = (totalNew > 0 && totalNew < totalItems) ? 'inline-flex' : 'none';
        }

        if (discoveryBtnNewCount) discoveryBtnNewCount.textContent = totalNew;
        if (discoveryBtnAllCount) discoveryBtnAllCount.textContent = totalItems;

        if (discoveryFooterCount) {
            if (totalSelected === 0) {
                discoveryFooterCount.innerHTML = `No items selected (0 of ${totalItems})`;
            } else if (totalSelected === totalItems) {
                discoveryFooterCount.innerHTML = `All <strong>${totalItems}</strong> items selected`;
            } else {
                discoveryFooterCount.innerHTML = `Selected <strong>${totalSelected}</strong> of ${totalItems} items`;
            }
        }

        if (discoveryIngestBtn) {
            discoveryIngestBtn.disabled = totalSelected === 0;
            if (discoveryIngestText) {
                discoveryIngestText.textContent = totalSelected > 0 ? `Add to Library (${totalSelected})` : 'Select Items to Add';
            }
        }

        if (discoveryClearSelBtn) {
            discoveryClearSelBtn.disabled = totalSelected === 0;
        }

        syncDiscoveryFilterButtons();
    }

    function updateGridCardSelectionStates() {
        if (!discoveryGrid) return;
        const cards = discoveryGrid.querySelectorAll('.sibling-card');
        cards.forEach(card => {
            const url = card.dataset.url;
            if (!url) return;
            const isSelected = selectedSiblingUrls.has(url);
            const checkbox = card.querySelector('.sibling-checkbox');
            if (checkbox) checkbox.checked = isSelected;
            card.classList.toggle('selected', isSelected);
        });
        updateDiscoverySelectionCounts();
    }

    function renderDiscoveredGrid(siblings) {
        if (!discoveryGrid) return;
        discoveryGrid.innerHTML = '';

        siblings.forEach(sibling => {
            const isSelected = selectedSiblingUrls.has(sibling.url);
            const inLibrary = !!sibling.in_library;
            const extUpper = (sibling.extension || 'MEDIA').toUpperCase();
            const sizeText = sibling.size_bytes ? formatBytes(sibling.size_bytes) : extUpper;
            const thumbUrl = `/api/thumbnail?url=${encodeURIComponent(sibling.url)}&size=320`;

            const isVid = ['MP4', 'WEBM', 'MOV', 'M4V', 'MKV', 'AVI', 'OGV'].includes(extUpper) || (sibling.mime_type && sibling.mime_type.startsWith('video/'));
            const thumbMediaHtml = isVid
                ? `<video class="lazy-video" src="${escapeHtml(sibling.url)}" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"></video>
                   <span style="display:none;font-size:11px;font-weight:700;color:var(--muted);">${escapeHtml(extUpper)}</span>`
                : `<img src="${escapeHtml(thumbUrl)}" alt="${escapeHtml(sibling.filename)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
                   <span style="display:none;font-size:11px;font-weight:700;color:var(--muted);">${escapeHtml(extUpper)}</span>`;

            const card = document.createElement('div');
            card.className = `sibling-card ${isSelected ? 'selected' : ''} ${inLibrary ? 'in-library' : ''}`;
            card.dataset.url = sibling.url;
            card.innerHTML = `
                <div class="sibling-thumb-wrap">
                    ${thumbMediaHtml}
                    <span class="sibling-status-pill ${inLibrary ? 'existing' : 'new'}">
                        ${inLibrary ? 'In Index' : 'New'}
                    </span>
                </div>
                <div class="sibling-card-body">
                    <div class="sibling-row-head">
                        <input type="checkbox" class="sibling-checkbox" ${isSelected ? 'checked' : ''}>
                        <span class="sibling-filename" title="${escapeHtml(sibling.filename)}">${escapeHtml(sibling.filename)}</span>
                    </div>
                    <div class="sibling-meta-row">
                        <span>${escapeHtml(extUpper)}</span>
                        <span>${escapeHtml(sizeText)}</span>
                    </div>
                </div>
            `;

            const checkbox = card.querySelector('.sibling-checkbox');
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selectedSiblingUrls.add(sibling.url);
                    card.classList.add('selected');
                } else {
                    selectedSiblingUrls.delete(sibling.url);
                    card.classList.remove('selected');
                }
                updateDiscoverySelectionCounts();
            });

            card.addEventListener('click', (e) => {
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });

            discoveryGrid.appendChild(card);
        });

        updateDiscoverySelectionCounts();
    }

    async function openSiblingDiscoveryModal(seedUrl, triggerBtn = null) {
        if (!seedUrl || !discoveryModal) return;
        if (triggerBtn) triggerBtn.classList.add('magic-btn-spinning');
        discoveryModal.classList.add('active');

        const filename = seedUrl.split('/').pop().split('?')[0] || seedUrl;

        if (discoveryModalTitle) discoveryModalTitle.textContent = 'Find Related Media';
        if (discoveryModalSubtitle) discoveryModalSubtitle.textContent = 'Discovering additional files in this collection';
        if (discoveryTargetLabel) discoveryTargetLabel.textContent = 'Source:';
        if (discoverySeedUrl) {
            discoverySeedUrl.textContent = filename;
            discoverySeedUrl.title = seedUrl;
        }

        if (discoveryLoadingState) discoveryLoadingState.style.display = 'flex';
        if (discoveryLoadingMsg) discoveryLoadingMsg.textContent = 'Searching for related files...';
        if (discoveryEmptyState) discoveryEmptyState.style.display = 'none';
        if (discoveryResultsContainer) discoveryResultsContainer.style.display = 'none';
        if (discoveryStatusBadge) {
            discoveryStatusBadge.textContent = 'Searching...';
            discoveryStatusBadge.className = 'badge-status';
        }

        currentDiscoveredSiblings = [];
        selectedSiblingUrls.clear();
        updateDiscoverySelectionCounts();

        try {
            const res = await authFetch('/api/discover/siblings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: seedUrl })
            });

            const data = await res.json();
            if (discoveryLoadingState) discoveryLoadingState.style.display = 'none';

            if (data.status === 'standalone' || data.status === 'no_pattern') {
                if (discoveryEmptyState) {
                    discoveryEmptyState.style.display = 'flex';
                    if (discoveryEmptyTitle) discoveryEmptyTitle.textContent = 'No Related Media Found';
                    if (discoveryEmptyDesc) discoveryEmptyDesc.textContent = 'No other files in this collection could be located on the server.';
                }
                if (discoveryStatusBadge) discoveryStatusBadge.textContent = 'Single File';
                return;
            }

            if (data.status === 'success') {
                currentDiscoveredSiblings = data.siblings || [];
                // Re-evaluate in_library flag against local persistent store
                currentDiscoveredSiblings.forEach(s => {
                    s.in_library = LocalStorageDB.hasUrl(s.url);
                });
                if (!currentDiscoveredSiblings.length) {
                    if (discoveryEmptyState) {
                        discoveryEmptyState.style.display = 'flex';
                        if (discoveryEmptyTitle) discoveryEmptyTitle.textContent = 'No Additional Media Found';
                        if (discoveryEmptyDesc) discoveryEmptyDesc.textContent = 'All available files for this series are already in your library.';
                    }
                    if (discoveryStatusBadge) discoveryStatusBadge.textContent = 'Up to Date';
                    return;
                }

                if (discoveryResultsContainer) discoveryResultsContainer.style.display = 'block';
                if (discoveryStatusBadge) discoveryStatusBadge.textContent = `✓ ${currentDiscoveredSiblings.length} Found`;
                if (discoveryVerifiedCount) discoveryVerifiedCount.textContent = currentDiscoveredSiblings.length;

                const newItems = currentDiscoveredSiblings.filter(s => !s.in_library);
                if (discoveryNewCount) discoveryNewCount.textContent = newItems.length;

                if (newItems.length > 0) {
                    newItems.forEach(s => selectedSiblingUrls.add(s.url));
                } else {
                    currentDiscoveredSiblings.forEach(s => selectedSiblingUrls.add(s.url));
                }
                renderDiscoveredGrid(currentDiscoveredSiblings);
            } else {
                if (discoveryEmptyState) {
                    discoveryEmptyState.style.display = 'flex';
                    if (discoveryEmptyTitle) discoveryEmptyTitle.textContent = 'Search Completed';
                    if (discoveryEmptyDesc) discoveryEmptyDesc.textContent = data.message || 'Could not find additional files for this item.';
                }
            }
        } catch (err) {
            if (discoveryLoadingState) discoveryLoadingState.style.display = 'none';
            if (discoveryEmptyState) {
                discoveryEmptyState.style.display = 'flex';
                if (discoveryEmptyTitle) discoveryEmptyTitle.textContent = 'Connection Error';
                if (discoveryEmptyDesc) discoveryEmptyDesc.textContent = 'Could not reach server to discover related media.';
            }
        } finally {
            if (triggerBtn) triggerBtn.classList.remove('magic-btn-spinning');
        }
    }

    async function openFolderDiscoveryModal(folderPath, domain, urls, triggerBtn = null) {
        if (!urls || !urls.length || !discoveryModal) return;
        if (triggerBtn) triggerBtn.classList.add('magic-btn-spinning');
        discoveryModal.classList.add('active');

        if (discoveryModalTitle) discoveryModalTitle.textContent = 'Scan Folder Collection';
        if (discoveryModalSubtitle) discoveryModalSubtitle.textContent = `Searching for missing files in this directory (${urls.length} existing)`;
        if (discoveryTargetLabel) discoveryTargetLabel.textContent = 'Folder:';
        if (discoverySeedUrl) {
            const folderSummary = `${domain || ''}${folderPath} (${urls.length} files)`;
            discoverySeedUrl.textContent = folderSummary;
            discoverySeedUrl.title = folderSummary;
        }

        if (discoveryLoadingState) discoveryLoadingState.style.display = 'flex';
        if (discoveryLoadingMsg) discoveryLoadingMsg.textContent = 'Scanning folder for missing media...';
        if (discoveryEmptyState) discoveryEmptyState.style.display = 'none';
        if (discoveryResultsContainer) discoveryResultsContainer.style.display = 'none';
        if (discoveryStatusBadge) {
            discoveryStatusBadge.textContent = 'Scanning...';
            discoveryStatusBadge.className = 'badge-status';
        }

        currentDiscoveredSiblings = [];
        selectedSiblingUrls.clear();
        updateDiscoverySelectionCounts();

        try {
            const res = await authFetch('/api/discover/folder-siblings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    folder_path: folderPath,
                    domain: domain,
                    urls: urls
                })
            });

            const data = await res.json();
            if (discoveryLoadingState) discoveryLoadingState.style.display = 'none';

            if (data.status === 'standalone' || data.status === 'no_pattern') {
                if (discoveryEmptyState) {
                    discoveryEmptyState.style.display = 'flex';
                    if (discoveryEmptyTitle) discoveryEmptyTitle.textContent = 'No Additional Files Found';
                    if (discoveryEmptyDesc) discoveryEmptyDesc.textContent = 'All available media files in this folder are already indexed.';
                }
                if (discoveryStatusBadge) discoveryStatusBadge.textContent = 'Up to Date';
                return;
            }

            if (data.status === 'success') {
                currentDiscoveredSiblings = data.siblings || [];
                // Re-evaluate in_library flag against local persistent store
                currentDiscoveredSiblings.forEach(s => {
                    s.in_library = LocalStorageDB.hasUrl(s.url);
                });
                if (!currentDiscoveredSiblings.length) {
                    if (discoveryEmptyState) {
                        discoveryEmptyState.style.display = 'flex';
                        if (discoveryEmptyTitle) discoveryEmptyTitle.textContent = 'Folder Complete';
                        if (discoveryEmptyDesc) discoveryEmptyDesc.textContent = 'All media files in this folder collection are already in your library.';
                    }
                    if (discoveryStatusBadge) discoveryStatusBadge.textContent = 'Up to Date';
                    return;
                }

                if (discoveryResultsContainer) discoveryResultsContainer.style.display = 'block';
                if (discoveryStatusBadge) discoveryStatusBadge.textContent = `✓ ${currentDiscoveredSiblings.length} Found`;
                if (discoveryVerifiedCount) discoveryVerifiedCount.textContent = currentDiscoveredSiblings.length;

                const newItems = currentDiscoveredSiblings.filter(s => !s.in_library);
                if (discoveryNewCount) discoveryNewCount.textContent = newItems.length;

                if (newItems.length > 0) {
                    newItems.forEach(s => selectedSiblingUrls.add(s.url));
                } else {
                    currentDiscoveredSiblings.forEach(s => selectedSiblingUrls.add(s.url));
                }
                renderDiscoveredGrid(currentDiscoveredSiblings);
            } else {
                if (discoveryEmptyState) {
                    discoveryEmptyState.style.display = 'flex';
                    if (discoveryEmptyTitle) discoveryEmptyTitle.textContent = 'Scan Completed';
                    if (discoveryEmptyDesc) discoveryEmptyDesc.textContent = data.message || 'No additional files found.';
                }
            }
        } catch (err) {
            if (discoveryLoadingState) discoveryLoadingState.style.display = 'none';
            if (discoveryEmptyState) {
                discoveryEmptyState.style.display = 'flex';
                if (discoveryEmptyTitle) discoveryEmptyTitle.textContent = 'Connection Error';
                if (discoveryEmptyDesc) discoveryEmptyDesc.textContent = 'Could not reach server to scan folder.';
            }
        } finally {
            if (triggerBtn) triggerBtn.classList.remove('magic-btn-spinning');
        }
    }

    if (discoverySelectNewBtn) {
        discoverySelectNewBtn.addEventListener('click', () => {
            selectedSiblingUrls.clear();
            currentDiscoveredSiblings.filter(s => !s.in_library).forEach(s => selectedSiblingUrls.add(s.url));
            updateGridCardSelectionStates();
        });
    }

    if (discoverySelectAllBtn) {
        discoverySelectAllBtn.addEventListener('click', () => {
            selectedSiblingUrls.clear();
            currentDiscoveredSiblings.forEach(s => selectedSiblingUrls.add(s.url));
            updateGridCardSelectionStates();
        });
    }

    if (discoveryClearSelBtn) {
        discoveryClearSelBtn.addEventListener('click', () => {
            selectedSiblingUrls.clear();
            updateGridCardSelectionStates();
        });
    }

    if (discoveryIngestBtn) {
        discoveryIngestBtn.addEventListener('click', async () => {
            const urls = Array.from(selectedSiblingUrls);
            if (!urls.length) return;

            discoveryIngestBtn.disabled = true;
            if (discoveryIngestText) discoveryIngestText.textContent = `Ingesting ${urls.length}...`;

            try {
                const res = await authFetch('/api/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ urls })
                });

                if (res.ok) {
                    showToast('Magic Discovery', `✓ Successfully added ${urls.length} verified sibling assets!`, 'success', 4000);
                    closeDiscoveryModal();
                    await loadTreeData();
                } else {
                    showToast('Import Error', 'Failed to import discovered siblings.', 'error');
                    discoveryIngestBtn.disabled = false;
                    updateDiscoverySelectionCounts();
                }
            } catch (err) {
                showToast('Network Error', err.message, 'error');
                discoveryIngestBtn.disabled = false;
                updateDiscoverySelectionCounts();
            }
        });
    }

    // -------------------------------------------------------------
    // 11. Real-Time Cross-Tab & Extension Synchronization
    // -------------------------------------------------------------
    let lastSyncTimestamp = 0;
    const syncBroadcastChannel = typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('media_index_sync_channel')
        : null;

    async function handleLiveSyncEvent(detail) {
        if (!detail) return;
        const now = Date.now();
        // Debounce rapid sync events within 500ms
        if (now - lastSyncTimestamp < 500) return;
        lastSyncTimestamp = now;

        const count = detail.count || 1;
        const targetUser = detail.userId || 'default';
        if (targetUser && targetUser !== currentUserId && currentUserId !== 'default') {
            return;
        }

        // Silently reload tree and grid data with 0 scroll disruption
        await loadTreeData();

        // Display confirmation toast
        showToast(
            'Extension Sync',
            `Received ${count} new media asset${count > 1 ? 's' : ''} from Companion.`,
            'success',
            3500
        );

        // Forward to other open tabs in the same origin
        if (syncBroadcastChannel && detail.broadcast !== false) {
            syncBroadcastChannel.postMessage({
                ...detail,
                broadcast: false
            });
        }
    }

    window.addEventListener('media-index-sync', (e) => {
        handleLiveSyncEvent(e.detail);
    });

    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'MEDIA_INDEX_SYNC') {
            handleLiveSyncEvent(e.data);
        }
    });

    if (syncBroadcastChannel) {
        syncBroadcastChannel.onmessage = (e) => {
            if (e.data && e.data.type === 'MEDIA_INDEX_SYNC') {
                handleLiveSyncEvent(e.data);
            }
        };
    }

    // Tab Focus & Visibility Auto-Revalidation
    let lastFocusCheckTime = Date.now();
    async function revalidateOnFocus() {
        const now = Date.now();
        // If tab was unfocused or idle for more than 2.5s, silently sync state
        if (now - lastFocusCheckTime > 2500) {
            lastFocusCheckTime = now;
            try {
                await loadTreeData();
            } catch {}
        }
    }

    window.addEventListener('focus', revalidateOnFocus);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            revalidateOnFocus();
        }
    });

    // -------------------------------------------------------------
    // 12. Initial Load
    // -------------------------------------------------------------
    setFocusMode(isFocusMode, true);
    setViewMode(currentViewMode);
    loadTreeData();
});
