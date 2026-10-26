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

    // Toast Container
    const toastContainer = document.getElementById('toast-container');

    // State Variables
    let rawTreeData = [];
    let currentSearchQuery = '';
    let lastUpdatedUrl = null;

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
                const ext = (node.extension || 'FILE').toUpperCase();
                const mType = node.media_type || 'image';
                const timeText = formatTimeAgo(node.last_updated || node.first_added);
                const truncated = truncateUrl(node.url);

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
                            <a href="${escapeHtml(node.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(node.url)}">
                                <strong>${highlightText(node.name, query)}</strong>
                            </a>
                            <small title="${escapeHtml(node.url)}">${escapeHtml(truncated)}</small>
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

                renderTree(rawTreeData, currentSearchQuery);
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
    // 8. Live Search & Tree Controls
    // -------------------------------------------------------------
    if (treeSearchInput) {
        treeSearchInput.addEventListener('input', (e) => {
            currentSearchQuery = e.target.value;
            if (clearSearchBtn) {
                clearSearchBtn.style.display = currentSearchQuery ? 'grid' : 'none';
            }
            renderTree(rawTreeData, currentSearchQuery);
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            if (treeSearchInput) {
                treeSearchInput.value = '';
                currentSearchQuery = '';
                clearSearchBtn.style.display = 'none';
                renderTree(rawTreeData, '');
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
                    renderTree(rawTreeData, '');
                } else {
                    treeSearchInput.blur();
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
    // 11. Initial Load
    // -------------------------------------------------------------
    loadTreeData();
});
