/**
 * Media URL Analyzer - Modern & Enhanced Client Application
 * - Silent user-scoping via localStorage and X-User-Id (no ID exposed to user)
 * - Enhanced search with match highlighting, live counter, and auto-expansion
 * - Category filter pills (Images, Videos, GIFs, Duplicates Only)
 * - Interactive media distribution widget
 * - Floating toast notifications and soft pulse without forced scrolling
 * - ASCII tree copier and clipboard tools
 */

document.addEventListener('DOMContentLoaded', () => {
    // -------------------------------------------------------------
    // 1. Silent User Identity Management (No UI exposure)
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
    const clearInputBtn = document.getElementById('clear-input-btn');
    const submitBtn = document.getElementById('submit-url-btn');
    const pasteBtn = document.getElementById('paste-clipboard-btn');
    const resetBtn = document.getElementById('reset-db-btn');

    // Export & Import
    const exportBtn = document.getElementById('export-btn');
    const sidebarExportBtn = document.getElementById('sidebar-export-btn');
    const importBtn = document.getElementById('import-btn');
    const sidebarImportBtn = document.getElementById('sidebar-import-btn');
    const importFileInput = document.getElementById('import-file-input');

    // Tree & Search Toolbar
    const treeContainer = document.getElementById('tree-container');
    const treeSearchInput = document.getElementById('tree-search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const searchMatchCount = document.getElementById('search-match-count');
    const expandAllBtn = document.getElementById('expand-all-btn');
    const collapseAllBtn = document.getElementById('collapse-all-btn');
    const copyTreeTextBtn = document.getElementById('copy-tree-text-btn');
    const treeItemCount = document.getElementById('tree-item-count');
    const filterPills = document.querySelectorAll('.filter-pill');
    const filterDupCount = document.getElementById('filter-dup-count');

    // Stats Elements
    const statUnique = document.getElementById('stat-unique-urls');
    const statTotal = document.getElementById('stat-total-submissions');
    const statDuplicates = document.getElementById('stat-duplicates');

    // Media Breakdown Widget
    const distTotalCount = document.getElementById('dist-total-count');
    const progImage = document.getElementById('prog-image');
    const progVideo = document.getElementById('prog-video');
    const progGif = document.getElementById('prog-gif');
    const progOther = document.getElementById('prog-other');
    const countImages = document.getElementById('count-images');
    const countVideos = document.getElementById('count-videos');
    const countGifs = document.getElementById('count-gifs');
    const countOther = document.getElementById('count-other');
    const legendItems = document.querySelectorAll('.legend-item');

    // Toast Container
    const toastContainer = document.getElementById('toast-container');

    // State Variables
    let rawTreeData = [];
    let currentFilterType = 'all'; // 'all' | 'image' | 'video' | 'gif' | 'duplicates'
    let currentSearchQuery = '';
    let lastUpdatedUrl = null;

    // -------------------------------------------------------------
    // 3. Floating Toast Notification System
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
    // 4. Data Loading & Aggregate Calculations
    // -------------------------------------------------------------
    async function loadTreeData() {
        try {
            const response = await authFetch('/api/tree');
            if (!response.ok) throw new Error('Failed to load tree data');

            const result = await response.json();
            if (result.status === 'success') {
                rawTreeData = result.tree || [];
                updateStats(result.stats);
                updateMediaBreakdown();
                applyFilterAndRender();
            }
        } catch (error) {
            console.error('Error loading tree:', error);
            showToast('Connection Error', 'Could not fetch your tree data from the server.', 'error');
        }
    }

    function updateStats(stats) {
        if (!stats) return;
        animateCounter(statUnique, stats.total_urls ?? 0);
        animateCounter(statTotal, stats.total_submissions ?? 0);
        animateCounter(statDuplicates, stats.duplicate_submissions ?? 0);

        if (treeItemCount) {
            const total = stats.total_urls ?? 0;
            treeItemCount.textContent = `${total} ${total === 1 ? 'file' : 'files'}`;
        }
    }

    function animateCounter(element, target) {
        if (!element) return;
        const current = parseInt(element.textContent.replace(/,/g, ''), 10) || 0;
        if (current === target) return;

        const diff = target - current;
        const step = diff > 0 ? Math.ceil(diff / 10) : Math.floor(diff / 10);
        const nextVal = current + step;

        element.textContent = nextVal.toLocaleString();
        if (nextVal !== target) {
            setTimeout(() => animateCounter(element, target), 25);
        } else {
            element.textContent = target.toLocaleString();
        }
    }

    // -------------------------------------------------------------
    // 5. Media Breakdown Widget Calculation
    // -------------------------------------------------------------
    function classifyExtension(ext) {
        const e = (ext || '').toLowerCase().trim();
        if (e === 'gif') return 'gif';
        if (['jpg', 'jpeg', 'png', 'webp', 'svg', 'bmp', 'avif', 'ico', 'tiff'].includes(e)) return 'image';
        if (['mp4', 'webm', 'ogg', 'mov', 'mkv', 'm4v', 'avi', 'flv'].includes(e)) return 'video';
        return 'other';
    }

    function updateMediaBreakdown() {
        let imgCount = 0, vidCount = 0, gifCount = 0, otherCount = 0, dupCount = 0;

        function traverse(node) {
            if (node.type === 'file') {
                const category = classifyExtension(node.extension);
                if (category === 'image') imgCount++;
                else if (category === 'video') vidCount++;
                else if (category === 'gif') gifCount++;
                else otherCount++;

                if ((node.count || 1) > 1) {
                    dupCount++;
                }
            } else if (node.children) {
                node.children.forEach(traverse);
            }
        }

        rawTreeData.forEach(traverse);
        const total = imgCount + vidCount + gifCount + otherCount;

        if (distTotalCount) distTotalCount.textContent = `${total} ${total === 1 ? 'file' : 'files'}`;
        if (countImages) countImages.textContent = imgCount;
        if (countVideos) countVideos.textContent = vidCount;
        if (countGifs) countGifs.textContent = gifCount;
        if (countOther) countOther.textContent = otherCount;
        if (filterDupCount) filterDupCount.textContent = dupCount;

        if (total > 0) {
            progImage.style.width = `${(imgCount / total) * 100}%`;
            progVideo.style.width = `${(vidCount / total) * 100}%`;
            progGif.style.width = `${(gifCount / total) * 100}%`;
            progOther.style.width = `${(otherCount / total) * 100}%`;
        } else {
            progImage.style.width = '0%';
            progVideo.style.width = '0%';
            progGif.style.width = '0%';
            progOther.style.width = '0%';
        }
    }

    // -------------------------------------------------------------
    // 6. Enhanced Tree Filtering & Search Algorithm
    // -------------------------------------------------------------
    function filterNode(node, query, categoryFilter) {
        if (node.type === 'file') {
            const extCat = classifyExtension(node.extension);
            const isDup = (node.count || 1) > 1;

            // Check Category Filter
            if (categoryFilter === 'image' && extCat !== 'image') return null;
            if (categoryFilter === 'video' && extCat !== 'video') return null;
            if (categoryFilter === 'gif' && extCat !== 'gif') return null;
            if (categoryFilter === 'other' && extCat !== 'other') return null;
            if (categoryFilter === 'duplicates' && !isDup) return null;

            // Check Text Query
            if (query) {
                const nameMatches = node.name.toLowerCase().includes(query);
                const urlMatches = (node.url || '').toLowerCase().includes(query);
                const extMatches = (node.extension || '').toLowerCase().includes(query);
                if (!nameMatches && !urlMatches && !extMatches) return null;
            }

            return { ...node };
        }

        // For Domain or Folder: filter children recursively
        if (node.children && node.children.length > 0) {
            const filteredChildren = [];
            for (const child of node.children) {
                const res = filterNode(child, query, categoryFilter);
                if (res) filteredChildren.push(res);
            }

            // If children matched, keep this folder/domain
            if (filteredChildren.length > 0) {
                return {
                    ...node,
                    children: filteredChildren,
                    autoExpanded: true
                };
            }

            // Or if the folder itself matches query and no category filter restrictions
            if (query && categoryFilter === 'all' && node.name.toLowerCase().includes(query)) {
                return { ...node, children: [] };
            }
        }

        return null;
    }

    function applyFilterAndRender() {
        const query = currentSearchQuery.trim().toLowerCase();

        let filteredTree = [];
        let totalMatches = 0;

        if (!query && currentFilterType === 'all') {
            filteredTree = rawTreeData;
            if (searchMatchCount) searchMatchCount.classList.add('hidden');
        } else {
            for (const domainNode of rawTreeData) {
                const res = filterNode(domainNode, query, currentFilterType);
                if (res) filteredTree.push(res);
            }

            // Count total matching file nodes
            function countFiles(n) {
                if (n.type === 'file') totalMatches++;
                else if (n.children) n.children.forEach(countFiles);
            }
            filteredTree.forEach(countFiles);

            if (searchMatchCount) {
                searchMatchCount.classList.remove('hidden');
                searchMatchCount.textContent = `${totalMatches} ${totalMatches === 1 ? 'match' : 'matches'}`;
            }
        }

        renderTree(filteredTree, query);
    }

    // -------------------------------------------------------------
    // 7. Tree Renderer with Substring Highlighting
    // -------------------------------------------------------------
    function highlightText(text, query) {
        if (!query || !text) return escapeHtml(text);
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedQuery})`, 'gi');
        return escapeHtml(text).replace(regex, '<mark class="search-highlight">$1</mark>');
    }

    function escapeHtml(str) {
        return (str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function renderTree(tree, activeQuery = '') {
        treeContainer.innerHTML = '';

        if (!tree || tree.length === 0) {
            if (activeQuery || currentFilterType !== 'all') {
                treeContainer.innerHTML = `
                    <div class="no-search-results">
                        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <h3 class="empty-state-title">No Matching Results</h3>
                        <p class="empty-state-text">No media found matching current filter or query "${escapeHtml(activeQuery)}".</p>
                        <button type="button" id="reset-filter-btn" class="no-search-results-btn">Clear Search & Filters</button>
                    </div>
                `;
                const resetFilterBtn = document.getElementById('reset-filter-btn');
                if (resetFilterBtn) {
                    resetFilterBtn.addEventListener('click', () => {
                        treeSearchInput.value = '';
                        currentSearchQuery = '';
                        currentFilterType = 'all';
                        clearSearchBtn.classList.add('hidden');
                        filterPills.forEach(p => p.classList.toggle('active', p.getAttribute('data-type') === 'all'));
                        applyFilterAndRender();
                    });
                }
            } else {
                treeContainer.innerHTML = `
                    <div class="empty-tree-state">
                        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <h3 class="empty-state-title">No URLs Analyzed Yet</h3>
                        <p class="empty-state-text">Paste a media URL on the left panel to begin exploring its storage path hierarchy.</p>
                    </div>
                `;
            }
            return;
        }

        const rootList = document.createElement('ul');
        rootList.className = 'tree-list';

        tree.forEach(domainNode => {
            const domainItem = buildNodeElement(domainNode, activeQuery);
            rootList.appendChild(domainItem);
        });

        treeContainer.appendChild(rootList);

        // Soft Highlight if lastUpdatedUrl is present
        if (lastUpdatedUrl) {
            const targetNode = document.querySelector(`[data-url="${CSS.escape(lastUpdatedUrl)}"]`);
            if (targetNode) {
                targetNode.classList.add('highlight-pulse');
                setTimeout(() => targetNode.classList.remove('highlight-pulse'), 2500);
            }
        }
    }

    function buildNodeElement(node, activeQuery = '') {
        const li = document.createElement('li');
        li.className = `tree-node tree-node-${node.type}`;

        const row = document.createElement('div');
        row.className = `node-row ${node.type}-row`;

        if (node.type === 'domain' || node.type === 'folder') {
            // Chevron Toggle Icon
            const chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            chevronSvg.setAttribute('class', 'toggle-icon');
            chevronSvg.setAttribute('viewBox', '0 0 24 24');
            chevronSvg.setAttribute('fill', 'none');
            chevronSvg.setAttribute('stroke-width', '2.5');
            chevronSvg.setAttribute('stroke-linecap', 'round');
            chevronSvg.setAttribute('stroke-linejoin', 'round');
            chevronSvg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
            row.appendChild(chevronSvg);

            // Icon
            const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            iconSvg.setAttribute('class', `type-icon ${node.type}-icon`);
            iconSvg.setAttribute('viewBox', '0 0 24 24');
            iconSvg.setAttribute('fill', 'none');
            iconSvg.setAttribute('stroke-width', '2');
            iconSvg.setAttribute('stroke-linecap', 'round');
            iconSvg.setAttribute('stroke-linejoin', 'round');

            if (node.type === 'domain') {
                iconSvg.innerHTML = `
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                `;
            } else {
                iconSvg.innerHTML = `
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                `;
            }
            row.appendChild(iconSvg);

            // Name with query highlight
            const nameSpan = document.createElement('span');
            nameSpan.className = `node-name ${node.type}-name`;
            nameSpan.innerHTML = highlightText(node.name, activeQuery);
            row.appendChild(nameSpan);

            li.appendChild(row);

            // Children branch
            if (node.children && node.children.length > 0) {
                const childUl = document.createElement('ul');
                childUl.className = 'tree-children';
                node.children.forEach(child => {
                    childUl.appendChild(buildNodeElement(child, activeQuery));
                });
                li.appendChild(childUl);

                // Auto-expand if search is active or node is tagged autoExpanded
                if (node.autoExpanded || activeQuery) {
                    row.classList.remove('collapsed');
                    childUl.style.display = 'block';
                }

                // Row click toggles collapse
                row.addEventListener('click', () => {
                    const isCollapsed = row.classList.toggle('collapsed');
                    childUl.style.display = isCollapsed ? 'none' : 'block';
                });
            }
        } else if (node.type === 'file') {
            row.setAttribute('data-url', node.url);

            const ext = (node.extension || '').toLowerCase();
            const category = classifyExtension(ext);

            const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            iconSvg.setAttribute('class', `type-icon file-icon ${category}`);
            iconSvg.setAttribute('viewBox', '0 0 24 24');
            iconSvg.setAttribute('fill', 'none');
            iconSvg.setAttribute('stroke-width', '2');
            iconSvg.setAttribute('stroke-linecap', 'round');
            iconSvg.setAttribute('stroke-linejoin', 'round');

            if (category === 'video') {
                iconSvg.innerHTML = `<polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>`;
            } else if (category === 'image' || category === 'gif') {
                iconSvg.innerHTML = `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>`;
            } else {
                iconSvg.innerHTML = `<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline>`;
            }
            row.appendChild(iconSvg);

            // Extension tag
            if (ext) {
                const extTag = document.createElement('span');
                extTag.className = `ext-tag ${category}`;
                extTag.textContent = ext;
                row.appendChild(extTag);
            }

            // File Name with Highlight
            const nameSpan = document.createElement('span');
            nameSpan.className = 'node-name file-name';
            nameSpan.innerHTML = highlightText(node.name, activeQuery);
            nameSpan.title = node.url;
            row.appendChild(nameSpan);

            // Duplicate Count Badge (if count > 1)
            const count = node.count ?? 1;
            if (count > 1) {
                const badge = document.createElement('span');
                badge.className = 'badge-count duplicate-active';
                badge.textContent = `x${count}`;
                badge.title = `Pasted ${count} times (${count - 1} duplicate${count > 2 ? 's' : ''})`;
                row.appendChild(badge);
            }

            // Actions on Hover (Copy URL & Open Link)
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'node-actions';

            // Copy Button
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'node-action-btn';
            copyBtn.title = 'Copy URL to clipboard';
            copyBtn.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            `;
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(node.url);
                    copyBtn.innerHTML = `
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent-emerald)" stroke-width="2.5">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    `;
                    showToast('Copied', 'Media URL copied to clipboard!', 'info', 2000);
                    setTimeout(() => {
                        copyBtn.innerHTML = `
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        `;
                    }, 1800);
                } catch (err) {
                    showToast('Error', 'Could not copy to clipboard', 'error');
                }
            });
            actionsDiv.appendChild(copyBtn);

            // Open in New Tab Button
            const openLink = document.createElement('a');
            openLink.href = node.url;
            openLink.target = '_blank';
            openLink.rel = 'noopener noreferrer';
            openLink.className = 'node-action-btn';
            openLink.title = 'Open media in new tab';
            openLink.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
            `;
            openLink.addEventListener('click', (e) => e.stopPropagation());
            actionsDiv.appendChild(openLink);

            row.appendChild(actionsDiv);
            li.appendChild(row);
        }

        return li;
    }

    // -------------------------------------------------------------
    // 8. Search & Filter Event Handlers
    // -------------------------------------------------------------
    treeSearchInput.addEventListener('input', (e) => {
        currentSearchQuery = e.target.value || '';
        if (currentSearchQuery.trim()) {
            clearSearchBtn.classList.remove('hidden');
        } else {
            clearSearchBtn.classList.add('hidden');
        }
        applyFilterAndRender();
    });

    clearSearchBtn.addEventListener('click', () => {
        treeSearchInput.value = '';
        currentSearchQuery = '';
        clearSearchBtn.classList.add('hidden');
        treeSearchInput.focus();
        applyFilterAndRender();
    });

    // Keyboard Shortcuts: '/' focuses search, 'Esc' clears
    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement !== urlInput && document.activeElement !== treeSearchInput) {
            e.preventDefault();
            treeSearchInput.focus();
        } else if (e.key === 'Escape' && document.activeElement === treeSearchInput) {
            treeSearchInput.value = '';
            currentSearchQuery = '';
            clearSearchBtn.classList.add('hidden');
            treeSearchInput.blur();
            applyFilterAndRender();
        }
    });

    // Filter Pills Click Handler
    filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            filterPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentFilterType = pill.getAttribute('data-type') || 'all';
            applyFilterAndRender();
        });
    });

    // Legend Click Filter
    legendItems.forEach(item => {
        item.addEventListener('click', () => {
            const filterType = item.getAttribute('data-filter');
            filterPills.forEach(p => {
                const matches = p.getAttribute('data-type') === filterType;
                p.classList.toggle('active', matches);
            });
            currentFilterType = filterType;
            applyFilterAndRender();
        });
    });

    // -------------------------------------------------------------
    // 9. ASCII Directory Tree Exporter
    // -------------------------------------------------------------
    function generateAsciiTree(nodes, indent = '') {
        let lines = [];
        nodes.forEach((node, idx) => {
            const isLast = idx === nodes.length - 1;
            const branch = isLast ? '└── ' : '├── ';
            const childIndent = indent + (isLast ? '    ' : '│   ');

            if (node.type === 'domain') {
                lines.push(`${indent}${branch}🌐 ${node.name}`);
            } else if (node.type === 'folder') {
                lines.push(`${indent}${branch}📁 ${node.name}/`);
            } else {
                const dup = (node.count > 1) ? ` [x${node.count}]` : '';
                lines.push(`${indent}${branch}📄 ${node.name}${dup}`);
            }

            if (node.children && node.children.length > 0) {
                lines.push(generateAsciiTree(node.children, childIndent));
            }
        });
        return lines.join('\n');
    }

    copyTreeTextBtn.addEventListener('click', async () => {
        if (!rawTreeData || rawTreeData.length === 0) {
            showToast('Tree Empty', 'No tree structure to copy.', 'info');
            return;
        }

        try {
            const ascii = generateAsciiTree(rawTreeData);
            await navigator.clipboard.writeText(ascii);
            showToast('Tree Copied', 'ASCII directory hierarchy copied to clipboard!', 'success');
        } catch (err) {
            showToast('Copy Failed', 'Could not copy tree to clipboard.', 'error');
        }
    });

    // Expand & Collapse All
    expandAllBtn.addEventListener('click', () => {
        const folderRows = document.querySelectorAll('.domain-row, .folder-row');
        folderRows.forEach(row => {
            row.classList.remove('collapsed');
            const childUl = row.parentElement.querySelector('.tree-children');
            if (childUl) childUl.style.display = 'block';
        });
    });

    collapseAllBtn.addEventListener('click', () => {
        const folderRows = document.querySelectorAll('.domain-row, .folder-row');
        folderRows.forEach(row => {
            row.classList.add('collapsed');
            const childUl = row.parentElement.querySelector('.tree-children');
            if (childUl) childUl.style.display = 'none';
        });
    });

    // -------------------------------------------------------------
    // 10. URL Submission Workflow
    // -------------------------------------------------------------
    async function submitUrl(url) {
        const trimmed = url ? url.trim() : '';
        if (!trimmed) {
            showToast('Invalid URL', 'Please enter a non-empty media URL.', 'error');
            return;
        }

        submitBtn.disabled = true;
        const spinner = submitBtn.querySelector('.btn-spinner');
        const icon = submitBtn.querySelector('.btn-icon');
        if (spinner) spinner.classList.remove('hidden');
        if (icon) icon.classList.add('hidden');

        try {
            const response = await authFetch('/api/urls', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: trimmed })
            });

            const data = await response.json();

            if (!response.ok) {
                showToast('Validation Error', data.message || 'Unable to parse URL.', 'error');
            } else {
                lastUpdatedUrl = trimmed;

                if (data.is_duplicate) {
                    showToast(
                        'Duplicate Caught',
                        `URL already stored! Paste count increased to x${data.count}.`,
                        'duplicate',
                        4500
                    );
                } else {
                    showToast(
                        'URL Analyzed',
                        `Added "${data.entry?.filename || 'file'}" to storage tree.`,
                        'success',
                        4000
                    );
                }

                urlInput.value = '';
                toggleClearInputBtn();
                await loadTreeData();
            }
        } catch (err) {
            console.error('Submission failed:', err);
            showToast('Network Error', 'Could not reach the server to analyze URL.', 'error');
        } finally {
            submitBtn.disabled = false;
            if (spinner) spinner.classList.add('hidden');
            if (icon) icon.classList.remove('hidden');
        }
    }

    function toggleClearInputBtn() {
        if (!clearInputBtn) return;
        if (urlInput.value && urlInput.value.length > 0) {
            clearInputBtn.classList.remove('hidden');
        } else {
            clearInputBtn.classList.add('hidden');
        }
    }

    urlInput.addEventListener('input', toggleClearInputBtn);

    if (clearInputBtn) {
        clearInputBtn.addEventListener('click', () => {
            urlInput.value = '';
            toggleClearInputBtn();
            urlInput.focus();
        });
    }

    urlForm.addEventListener('submit', (e) => {
        e.preventDefault();
        submitUrl(urlInput.value);
    });

    pasteBtn.addEventListener('click', async () => {
        try {
            if (navigator.clipboard && navigator.clipboard.readText) {
                const text = await navigator.clipboard.readText();
                if (text && text.trim()) {
                    urlInput.value = text.trim();
                    toggleClearInputBtn();
                    urlInput.focus();
                } else {
                    showToast('Clipboard Empty', 'No text found in clipboard.', 'info');
                }
            } else {
                urlInput.focus();
                showToast('Clipboard Notice', 'Direct clipboard reading unavailable. Use Ctrl+V.', 'info');
            }
        } catch (err) {
            urlInput.focus();
            showToast('Clipboard Notice', 'Please paste manually using Ctrl+V or right-click.', 'info');
        }
    });

    // -------------------------------------------------------------
    // 11. Export & Import Workflows
    // -------------------------------------------------------------
    async function handleExport() {
        try {
            showToast('Preparing Export', 'Generating your database export...', 'info', 2000);
            const response = await authFetch('/api/export');
            if (!response.ok) throw new Error('Export request failed');

            const disposition = response.headers.get('Content-Disposition');
            let filename = 'mua_export.json';
            if (disposition && disposition.includes('filename=')) {
                const match = disposition.match(/filename="?([^";]+)"?/);
                if (match && match[1]) filename = match[1];
            }

            const blob = await response.blob();
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);

            showToast('Export Ready', `Downloaded "${filename}" successfully.`, 'success');
        } catch (err) {
            console.error('Export error:', err);
            showToast('Export Failed', 'Could not export database.', 'error');
        }
    }

    exportBtn.addEventListener('click', handleExport);
    sidebarExportBtn.addEventListener('click', handleExport);

    function triggerImportPicker() {
        importFileInput.value = '';
        importFileInput.click();
    }

    importBtn.addEventListener('click', triggerImportPicker);
    sidebarImportBtn.addEventListener('click', triggerImportPicker);

    importFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showToast('Processing Import', `Reading "${file.name}"...`, 'info', 3000);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await authFetch('/api/import', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (!response.ok) {
                showToast('Import Error', data.message || 'Failed to import JSON file.', 'error');
            } else {
                showToast(
                    'Import Complete',
                    `Successfully added ${data.imported} new and merged ${data.merged} existing URLs!`,
                    'success',
                    5000
                );
                await loadTreeData();
            }
        } catch (err) {
            console.error('Import error:', err);
            showToast('Import Failed', 'Failed to parse and upload JSON file.', 'error');
        }
    });

    // -------------------------------------------------------------
    // 12. Reset Database Workflow
    // -------------------------------------------------------------
    resetBtn.addEventListener('click', async () => {
        const confirmed = confirm(
            'Are you sure you want to clear all stored URLs? This cannot be undone.'
        );
        if (!confirmed) return;

        try {
            const res = await authFetch('/api/clear', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                lastUpdatedUrl = null;
                showToast('Data Cleared', 'All analyzed URLs have been reset.', 'info');
                await loadTreeData();
            } else {
                showToast('Reset Error', data.message || 'Could not reset database.', 'error');
            }
        } catch (err) {
            console.error('Reset error:', err);
            showToast('Reset Error', 'Error connecting to server for reset.', 'error');
        }
    });

    // -------------------------------------------------------------
    // Initial Load
    // -------------------------------------------------------------
    loadTreeData();
});
