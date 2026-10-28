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
 * - Expand all / Collapse all / Copy ASCII tree diagram
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
        let id = localStorage.getItem(STORAGE_KEY);
        if (!id || !id.trim()) {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                id = crypto.randomUUID();
            } else {
                id = 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
            }
            localStorage.setItem(STORAGE_KEY, id);
        }
        return id;
    }

    const currentUserId = getOrCreateUserId();

    function authFetch(url, options = {}) {
        const headers = options.headers ? { ...options.headers } : {};
        headers['X-User-Id'] = currentUserId;
        return fetch(url, { ...options, headers });
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

    // Reset Modal
    const resetDbBtn = document.getElementById('reset-db-btn');
    const resetModal = document.getElementById('reset-modal');
    const cancelResetBtn = document.getElementById('cancel-reset-btn');
    const confirmResetBtn = document.getElementById('confirm-reset-btn');

    // Tree & Search Toolbar
    const treeContainer = document.getElementById('tree-container');
    const treeSearchInput = document.getElementById('tree-search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const expandAllBtn = document.getElementById('expand-all-btn');
    const collapseAllBtn = document.getElementById('collapse-all-btn');
    const copyTreeTextBtn = document.getElementById('copy-tree-text-btn');

    // View Mode Toggle
    const viewModeToggle = document.getElementById('view-mode-toggle');
    const viewTreeBtn = document.getElementById('view-tree-btn');
    const viewGridBtn = document.getElementById('view-grid-btn');
    const librarySection = document.querySelector('.library-section');
    const librarySubtitle = document.getElementById('library-subtitle');
    const tableHead = document.getElementById('table-head');

    // Floating Hover Preview Card Elements
    const floatingPreviewCard = document.getElementById('floating-preview-card');
    const previewCardImg = document.getElementById('preview-card-img');
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

    // Global file lookup map
    const fileLookupMap = new Map();

    // Toast Container
    const toastContainer = document.getElementById('toast-container');

    // State Variables
    let rawTreeData = [];
    let currentSearchQuery = '';
    let lastUpdatedUrl = null;
    const VIEW_MODE_KEY = 'media_view_mode';
    let currentViewMode = localStorage.getItem(VIEW_MODE_KEY) || 'tree';

    // -------------------------------------------------------------
    // 3. Floating Toast Notifications
    // -------------------------------------------------------------
    const TOAST_ICONS = {
        success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
        duplicate: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
        error: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
        info: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
    };

    function showToast(title, message, type = 'info', duration = 4000) {
        if (!toastContainer) return;

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
            <div class="toast-progress" style="animation-duration: ${duration}ms;"></div>
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

        const autoTimer = setTimeout(dismiss, duration);

        toast.addEventListener('mouseenter', () => {
            clearTimeout(autoTimer);
            const progress = toast.querySelector('.toast-progress');
            if (progress) progress.style.animationPlayState = 'paused';
        });

        toastContainer.appendChild(toast);
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

        function renderNode(node) {
            if (node.type === 'domain') {
                const color = node.domain_color || 'violet';
                const domainType = node.domain_type || 'MEDIA SOURCE';
                const itemsCount = node.items_count || 0;
                const foldersCount = node.folders_count || 0;
                const timeText = formatTimeAgo(node.last_updated);

                let childrenHtml = '';
                if (node.children && node.children.length > 0) {
                    childrenHtml = node.children.map(renderNode).join('');
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

                let childrenHtml = '';
                if (node.children && node.children.length > 0) {
                    childrenHtml = node.children.map(renderNode).join('');
                }

                return `
                    <details class="tree-folder" open>
                        <summary class="tree-row folder-row">
                            <span class="tree-chevron" aria-label="Toggle folder"></span>
                            <span class="folder-icon nested-folder">
                                ${SVG_ICONS.nestedFolder}
                            </span>
                            <span class="tree-name">
                                <strong>${highlightText(node.name, query)}</strong>
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
                                <button type="button" class="row-preview-trigger" data-url="${escapeHtml(node.url)}" title="Quick preview" aria-label="Preview image">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                        <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                </button>
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

        // Apply search filtering
        function filterNode(node) {
            if (!query) return node;

            const nameMatches = node.name.toLowerCase().includes(query);
            const pathMatches = node.path && node.path.toLowerCase().includes(query);
            const urlMatches = node.url && node.url.toLowerCase().includes(query);
            const extMatches = node.extension && node.extension.toLowerCase().includes(query);

            if (node.type === 'file') {
                return (nameMatches || urlMatches || extMatches) ? node : null;
            }

            if (node.children) {
                const filteredChildren = node.children
                    .map(filterNode)
                    .filter(Boolean);

                if (filteredChildren.length > 0 || nameMatches || pathMatches) {
                    return {
                        ...node,
                        children: filteredChildren
                    };
                }
            }

            return null;
        }

        const filteredTree = query ? treeData.map(filterNode).filter(Boolean) : treeData;

        if (filteredTree.length === 0) {
            treeContainer.innerHTML = `
                <div class="empty-tree-state">
                    <h3 class="empty-title">No Matching Files</h3>
                    <p class="empty-desc">No entries match your search query "<strong>${escapeHtml(query)}</strong>".</p>
                </div>
            `;
            return;
        }

        html = filteredTree.map(renderNode).join('');
        treeContainer.innerHTML = html;
    }

    // Helper: extract all file leaves from hierarchical tree data
    function extractFilesFromTree(nodes, query = '') {
        const files = [];
        const q = query ? query.trim().toLowerCase() : '';

        function walk(node, domain = null) {
            if (!node) return;
            const currentDomain = node.type === 'domain' ? node.name : domain;

            if (node.type === 'file') {
                if (node.url) fileLookupMap.set(node.url, node);
                if (!q || 
                    (node.name && node.name.toLowerCase().includes(q)) ||
                    (node.url && node.url.toLowerCase().includes(q)) ||
                    (node.extension && node.extension.toLowerCase().includes(q)) ||
                    (currentDomain && currentDomain.toLowerCase().includes(q))
                ) {
                    files.push({ ...node, domain: currentDomain });
                }
                return;
            }

            if (node.children && Array.isArray(node.children)) {
                for (const child of node.children) {
                    walk(child, currentDomain);
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

    // Grid View Renderer
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

        const cardsHtml = files.map(file => {
            const ext = (file.extension || 'FILE').toUpperCase();
            const mType = file.media_type || 'image';
            const meta = file.metadata || {};
            const timeText = formatTimeAgo(file.last_updated || file.first_added);
            const isImage = mType === 'image' || mType === 'gif' || ['JPG', 'JPEG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'SVG'].includes(ext);
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
            } else if (mType === 'video' || ['MP4', 'WEBM', 'MOV', 'M4V'].includes(ext)) {
                thumbContent = `
                    <div class="media-card-fallback">
                        ${SVG_ICONS.video}
                        <span>${escapeHtml(ext)} Video</span>
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
        }).join('');

        treeContainer.innerHTML = `<div class="media-grid">${cardsHtml}</div>`;
        observeLazyThumbnails();
    }

    // IntersectionObserver for Lazy-Loaded Thumbnails
    let gridObserver = null;

    function observeLazyThumbnails() {
        if (gridObserver) {
            gridObserver.disconnect();
            gridObserver = null;
        }

        const lazyImages = treeContainer ? treeContainer.querySelectorAll('img.lazy-thumb') : [];
        if (!lazyImages || !lazyImages.length) return;

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

        if (typeof IntersectionObserver !== 'undefined') {
            gridObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        loadImg(img);
                        observer.unobserve(img);
                    }
                });
            }, { rootMargin: '200px 0px' });

            lazyImages.forEach(img => gridObserver.observe(img));
        } else {
            // Direct load fallback
            lazyImages.forEach(loadImg);
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

        // Media Thumbnail Preview
        if (isImg) {
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
        } else {
            if (previewCardImg) previewCardImg.style.display = 'none';
            if (previewThumbSkeleton) previewThumbSkeleton.style.display = 'none';
            if (previewDimBadge) previewDimBadge.style.display = 'none';
            if (previewCardFallback) {
                previewCardFallback.style.display = 'flex';
                if (mType === 'video' || ['MP4', 'WEBM', 'MOV', 'M4V'].includes(ext)) {
                    previewCardFallback.innerHTML = `${SVG_ICONS.video}<span>${escapeHtml(ext)} Video</span>`;
                } else {
                    previewCardFallback.innerHTML = `${SVG_ICONS.file}<span>${escapeHtml(ext)}</span>`;
                }
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

    // View Switching and Dispatch
    function setViewMode(mode) {
        if (mode !== 'tree' && mode !== 'grid') mode = 'tree';
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
        if (librarySection) librarySection.classList.toggle('is-grid-mode', mode === 'grid');
        if (tableHead) tableHead.style.display = mode === 'grid' ? 'none' : '';

        if (librarySubtitle) {
            librarySubtitle.textContent = mode === 'grid' 
                ? 'Visual gallery of analyzed media files' 
                : 'Analyzed files arranged by source and path';
        }

        renderActiveView();
    }

    function renderActiveView() {
        if (currentViewMode === 'grid') {
            renderGridView(rawTreeData, currentSearchQuery);
        } else {
            renderTree(rawTreeData, currentSearchQuery);
        }
    }

    // -------------------------------------------------------------
    // 6. Fetch & Refresh Tree Data
    // -------------------------------------------------------------
    async function loadTreeData() {
        try {
            const response = await authFetch('/api/tree');
            if (!response.ok) throw new Error('Failed to fetch data');

            const data = await response.json();
            if (data.status === 'success') {
                rawTreeData = data.tree || [];
                const stats = data.stats || {};

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
                if (copyTreeTextBtn) copyTreeTextBtn.disabled = !hasRecords;
                if (treeSearchInput) {
                    treeSearchInput.disabled = !hasRecords;
                    if (!hasRecords) {
                        treeSearchInput.value = '';
                        if (clearSearchBtn) clearSearchBtn.style.display = 'none';
                    }
                }

                renderActiveView();
            }
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
                        if (enrichData && enrichData.status === 'success' && enrichData.db_updated) {
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
                        showToast('Pasted', 'URL pasted from clipboard.', 'info', 2000);
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

    // Expand All / Collapse All
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => {
            const detailsElements = treeContainer.querySelectorAll('details');
            detailsElements.forEach(d => d.open = true);
            showToast('Expanded', 'All directory branches opened.', 'info', 2000);
        });
    }

    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => {
            const detailsElements = treeContainer.querySelectorAll('details');
            detailsElements.forEach(d => d.open = false);
            showToast('Collapsed', 'All directory branches closed.', 'info', 2000);
        });
    }

    // Floating Hover Preview Event Delegation
    if (floatingPreviewCard) {
        floatingPreviewCard.addEventListener('mouseenter', () => clearTimeout(hoverHideTimer));
        floatingPreviewCard.addEventListener('mouseleave', () => cancelHoverPreview());
    }

    if (treeContainer) {
        treeContainer.addEventListener('mouseover', (e) => {
            const previewTrigger = e.target.closest('.row-preview-trigger, .file-icon');
            const rowOrCard = e.target.closest('.file-row, .media-card');
            if (!rowOrCard) return;

            const url = rowOrCard.getAttribute('data-url');
            if (!url) return;
            const node = fileLookupMap.get(url);
            if (!node) return;

            if (previewTrigger) {
                // User deliberately hovered over preview eye button or icon: fast reveal
                queueHoverPreview(node, previewTrigger, 100);
            } else if (currentViewMode === 'grid') {
                // Grid view card hover
                queueHoverPreview(node, rowOrCard, 220);
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
            const previewTrigger = e.target.closest('.row-preview-trigger');
            if (previewTrigger) {
                e.preventDefault();
                e.stopPropagation();
                const url = previewTrigger.getAttribute('data-url');
                const node = fileLookupMap.get(url);
                if (node) {
                    showHoverPreview(node, previewTrigger);
                }
            }
        });
    }

    window.addEventListener('scroll', () => hideHoverPreview(), { passive: true });

    // Copy ASCII Tree Diagram
    function generateAsciiTree(nodes, indent = '') {
        let result = '';
        nodes.forEach((node, idx) => {
            const isLast = idx === nodes.length - 1;
            const branch = isLast ? '└── ' : '├── ';
            const childIndent = indent + (isLast ? '    ' : '│   ');

            if (node.type === 'domain') {
                result += `${indent}${branch}🌐 ${node.name} (${node.domain_type || 'SOURCE'})\n`;
            } else if (node.type === 'folder') {
                result += `${indent}${branch}📁 ${node.name}/\n`;
            } else if (node.type === 'file') {
                const countBadge = node.count > 1 ? ` (↻ ${node.count})` : '';
                result += `${indent}${branch}📄 ${node.name} [${node.extension || 'FILE'}]${countBadge}\n`;
            }

            if (node.children && node.children.length > 0) {
                result += generateAsciiTree(node.children, childIndent);
            }
        });
        return result;
    }

    if (copyTreeTextBtn) {
        copyTreeTextBtn.addEventListener('click', async () => {
            if (!rawTreeData || rawTreeData.length === 0) {
                showToast('Empty Tree', 'No directory structure to copy.', 'info');
                return;
            }

            const ascii = 'MEDIA INDEX — DIRECTORY HIERARCHY\n' +
                          '=================================\n' +
                          generateAsciiTree(rawTreeData);

            try {
                await navigator.clipboard.writeText(ascii);
                showToast('Copied to Clipboard', 'ASCII directory tree copied successfully!', 'success');
            } catch {
                showToast('Copy Failed', 'Clipboard access not permitted.', 'error');
            }
        });
    }

    // -------------------------------------------------------------
    // 9. Export & Import Backup
    // -------------------------------------------------------------
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            if (!rawTreeData || rawTreeData.length === 0) {
                showToast('No Records', 'Nothing to export. Add some URLs first.', 'info');
                return;
            }

            try {
                showToast('Exporting Data', 'Preparing backup JSON...', 'info', 2000);
                const response = await authFetch('/api/export');
                if (!response.ok) throw new Error('Export failed');

                const blob = await response.blob();
                const now = new Date();
                const dateStr = now.toISOString().slice(0, 10);
                const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
                const filename = `media_index_export_${dateStr}_${timeStr}.json`;

                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();

                showToast('Export Complete', `Saved as ${filename}`, 'success');
            } catch (err) {
                console.error('Export error:', err);
                showToast('Export Error', 'Failed to generate backup JSON.', 'error');
            }
        });
    }

    if (importBtn && importFileInput) {
        importBtn.addEventListener('click', () => {
            importFileInput.value = '';
            importFileInput.click();
        });

        importFileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            showToast('Importing Data', `Parsing ${file.name}...`, 'info', 2500);
            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await authFetch('/api/import', {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();
                if (response.ok && data.status === 'success') {
                    showToast(
                        'Import Successful',
                        `Imported ${data.imported_count || 0} URLs (${data.duplicate_count || 0} duplicates merged).`,
                        'success'
                    );
                    await loadTreeData();
                } else {
                    showToast('Import Failed', data.message || 'Invalid backup file.', 'error');
                }
            } catch (err) {
                console.error('Import error:', err);
                showToast('Import Error', 'Failed to upload backup JSON.', 'error');
            }
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
                const response = await authFetch('/api/clear', { method: 'POST' });
                const data = await response.json();

                if (response.ok && data.status === 'cleared') {
                    showToast('Database Reset', 'All stored URLs have been cleared.', 'info');
                    await loadTreeData();
                } else {
                    showToast('Reset Failed', data.message || 'Could not reset database.', 'error');
                }
            } catch (err) {
                console.error('Reset error:', err);
                showToast('Network Error', 'Failed to reset database.', 'error');
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

            // 1. Close Modal if active
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

        // Shortcut: Toggle View Mode (Shift+T for Tree, Shift+G for Grid)
        if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !isTyping) {
            if (e.key === 'T' || e.key === 't') {
                e.preventDefault();
                setViewMode('tree');
                showToast('View Changed', 'Switched to Tree View', 'info', 1500);
                return;
            }
            if (e.key === 'G' || e.key === 'g') {
                e.preventDefault();
                setViewMode('grid');
                showToast('View Changed', 'Switched to Grid View', 'info', 1500);
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
    // 11. Initial Load
    // -------------------------------------------------------------
    setViewMode(currentViewMode);
    loadTreeData();
});
