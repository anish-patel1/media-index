/**
 * Media URL Analyzer - Interactive Client Application
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const urlForm = document.getElementById('url-form');
    const urlInput = document.getElementById('url-input');
    const submitBtn = document.getElementById('submit-url-btn');
    const pasteBtn = document.getElementById('paste-clipboard-btn');
    const resetBtn = document.getElementById('reset-db-btn');
    const statusBanner = document.getElementById('status-banner');
    const statusMessage = document.getElementById('status-message');
    const treeContainer = document.getElementById('tree-container');
    const expandAllBtn = document.getElementById('expand-all-btn');
    const collapseAllBtn = document.getElementById('collapse-all-btn');
    const samplePills = document.querySelectorAll('.sample-pill');

    // Stat Counters
    const statUnique = document.getElementById('stat-unique-urls');
    const statTotal = document.getElementById('stat-total-submissions');
    const statDuplicates = document.getElementById('stat-duplicates');

    // Banner auto-dismiss timer reference
    let bannerTimeout = null;

    // Track most recently updated URL to highlight in the tree
    let lastUpdatedUrl = null;

    /**
     * Display a notification banner with automatic fade-out
     */
    function showNotification(message, type = 'success', duration = 4000) {
        if (bannerTimeout) clearTimeout(bannerTimeout);

        statusBanner.className = `notification-banner ${type}`;
        statusMessage.textContent = message;
        statusBanner.classList.remove('hidden');

        if (duration > 0) {
            bannerTimeout = setTimeout(() => {
                statusBanner.classList.add('hidden');
            }, duration);
        }
    }

    /**
     * Fetch tree hierarchy and statistics from backend
     */
    async function loadTreeData() {
        try {
            const response = await fetch('/api/tree');
            if (!response.ok) throw new Error('Failed to fetch tree data');

            const result = await response.json();
            if (result.status === 'success') {
                updateStats(result.stats);
                renderTree(result.tree);
            }
        } catch (error) {
            console.error('Error loading tree:', error);
            showNotification('Could not load tree data from server.', 'error');
        }
    }

    /**
     * Update the header statistics ribbon
     */
    function updateStats(stats) {
        if (!stats) return;
        statUnique.textContent = stats.total_urls ?? 0;
        statTotal.textContent = stats.total_submissions ?? 0;
        statDuplicates.textContent = stats.duplicate_submissions ?? 0;
    }

    /**
     * Render the tree hierarchy recursively into the DOM
     */
    function renderTree(tree) {
        treeContainer.innerHTML = '';

        if (!tree || tree.length === 0) {
            treeContainer.innerHTML = `
                <div class="empty-tree-state">
                    <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <h3 class="empty-state-title">No URLs Analyzed Yet</h3>
                    <p class="empty-state-text">Paste a media URL above or click one of the quick samples to visualize its domain and storage directory path.</p>
                </div>
            `;
            return;
        }

        const rootList = document.createElement('ul');
        rootList.className = 'tree-list';

        tree.forEach(domainNode => {
            const domainItem = buildNodeElement(domainNode);
            rootList.appendChild(domainItem);
        });

        treeContainer.appendChild(rootList);

        // Highlight and scroll to the last updated URL if present
        if (lastUpdatedUrl) {
            const targetNode = document.querySelector(`[data-url="${CSS.escape(lastUpdatedUrl)}"]`);
            if (targetNode) {
                targetNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                targetNode.classList.add('highlight-pulse');
                setTimeout(() => targetNode.classList.remove('highlight-pulse'), 2000);
            }
        }
    }

    /**
     * Recursive builder for tree nodes (domain, folder, or file)
     */
    function buildNodeElement(node) {
        const li = document.createElement('li');
        li.className = `tree-node tree-node-${node.type}`;

        const row = document.createElement('div');
        row.className = `node-row ${node.type}-row`;

        if (node.type === 'domain' || node.type === 'folder') {
            // Toggle Chevron
            const chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            chevronSvg.setAttribute('class', 'toggle-icon');
            chevronSvg.setAttribute('viewBox', '0 0 24 24');
            chevronSvg.setAttribute('fill', 'none');
            chevronSvg.setAttribute('stroke-width', '2.5');
            chevronSvg.setAttribute('stroke-linecap', 'round');
            chevronSvg.setAttribute('stroke-linejoin', 'round');
            chevronSvg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
            row.appendChild(chevronSvg);

            // Domain / Folder Icon
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

            // Name
            const nameSpan = document.createElement('span');
            nameSpan.className = `node-name ${node.type}-name`;
            nameSpan.textContent = node.name;
            row.appendChild(nameSpan);

            li.appendChild(row);

            // Children container
            if (node.children && node.children.length > 0) {
                const childUl = document.createElement('ul');
                childUl.className = 'tree-children';
                node.children.forEach(child => {
                    childUl.appendChild(buildNodeElement(child));
                });
                li.appendChild(childUl);

                // Click event to toggle collapse/expand
                row.addEventListener('click', () => {
                    const isCollapsed = row.classList.toggle('collapsed');
                    childUl.style.display = isCollapsed ? 'none' : 'block';
                });
            }
        } else if (node.type === 'file') {
            row.setAttribute('data-url', node.url);

            // File Icon based on extension
            const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            const ext = (node.extension || '').toLowerCase();
            const isVideo = ['mp4', 'webm', 'ogg', 'mov', 'mkv'].includes(ext);
            const isImage = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'avif'].includes(ext);

            iconSvg.setAttribute('class', `type-icon file-icon ${isVideo ? 'video' : (isImage ? 'image' : '')}`);
            iconSvg.setAttribute('viewBox', '0 0 24 24');
            iconSvg.setAttribute('fill', 'none');
            iconSvg.setAttribute('stroke-width', '2');
            iconSvg.setAttribute('stroke-linecap', 'round');
            iconSvg.setAttribute('stroke-linejoin', 'round');

            if (isVideo) {
                iconSvg.innerHTML = `
                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                `;
            } else if (isImage) {
                iconSvg.innerHTML = `
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                `;
            } else {
                iconSvg.innerHTML = `
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                `;
            }
            row.appendChild(iconSvg);

            // File Name
            const nameSpan = document.createElement('span');
            nameSpan.className = 'node-name file-name';
            nameSpan.textContent = node.name;
            nameSpan.title = node.url;
            row.appendChild(nameSpan);

            // Duplicate Count Badge (only rendered if count > 1)
            const count = node.count ?? 1;
            if (count > 1) {
                const badge = document.createElement('span');
                badge.className = 'badge-count duplicate-active';
                badge.textContent = count;
                badge.title = `Pasted ${count} times (${count - 1} duplicate${count > 2 ? 's' : ''})`;
                row.appendChild(badge);
            }

            // External Link
            const linkA = document.createElement('a');
            linkA.href = node.url;
            linkA.target = '_blank';
            linkA.rel = 'noopener noreferrer';
            linkA.className = 'url-link-btn';
            linkA.title = 'Open URL in new tab';
            linkA.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
            `;
            row.appendChild(linkA);

            li.appendChild(row);
        }

        return li;
    }

    /**
     * Submit a URL to the backend
     */
    async function submitUrl(url) {
        const trimmedUrl = url ? url.trim() : '';
        if (!trimmedUrl) {
            showNotification('Please enter a valid URL.', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.classList.add('loading');

        try {
            const response = await fetch('/api/urls', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: trimmedUrl }),
            });

            const data = await response.json();

            if (!response.ok) {
                showNotification(data.message || 'Failed to process URL.', 'error');
            } else {
                lastUpdatedUrl = trimmedUrl;

                if (data.is_duplicate) {
                    showNotification(
                        `Duplicate URL! Paste count incremented to x${data.count}.`,
                        'duplicate'
                    );
                } else {
                    showNotification(
                        `New media path analyzed and added to the tree! (x${data.count})`,
                        'success'
                    );
                }

                urlInput.value = '';
                await loadTreeData();
            }
        } catch (error) {
            console.error('Submission error:', error);
            showNotification('Network error while submitting URL.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
        }
    }

    // Form Submit Event
    urlForm.addEventListener('submit', (e) => {
        e.preventDefault();
        submitUrl(urlInput.value);
    });

    // Paste from Clipboard Button
    pasteBtn.addEventListener('click', async () => {
        try {
            if (navigator.clipboard && navigator.clipboard.readText) {
                const text = await navigator.clipboard.readText();
                if (text) {
                    urlInput.value = text.trim();
                    urlInput.focus();
                } else {
                    showNotification('Clipboard is empty.', 'error');
                }
            } else {
                urlInput.focus();
                showNotification('Clipboard access not supported in this browser. Use Ctrl+V.', 'error');
            }
        } catch (err) {
            console.error('Clipboard error:', err);
            urlInput.focus();
            showNotification('Please paste using Ctrl+V or right-click.', 'error');
        }
    });

    // Quick Sample Pills
    samplePills.forEach(pill => {
        pill.addEventListener('click', () => {
            const sampleUrl = pill.getAttribute('data-url');
            if (sampleUrl) {
                urlInput.value = sampleUrl;
                submitUrl(sampleUrl);
            }
        });
    });

    // Reset Database Button
    resetBtn.addEventListener('click', async () => {
        const confirmed = confirm('Are you sure you want to clear all stored URLs and reset the tree?');
        if (!confirmed) return;

        try {
            const res = await fetch('/api/clear', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                lastUpdatedUrl = null;
                showNotification(data.message || 'Database reset successfully.', 'success');
                await loadTreeData();
            } else {
                showNotification(data.message || 'Failed to reset database.', 'error');
            }
        } catch (err) {
            console.error('Reset error:', err);
            showNotification('Error connecting to server for reset.', 'error');
        }
    });

    // Expand All Folders
    expandAllBtn.addEventListener('click', () => {
        const folderRows = document.querySelectorAll('.domain-row, .folder-row');
        folderRows.forEach(row => {
            row.classList.remove('collapsed');
            const childUl = row.parentElement.querySelector('.tree-children');
            if (childUl) childUl.style.display = 'block';
        });
    });

    // Collapse All Folders
    collapseAllBtn.addEventListener('click', () => {
        const folderRows = document.querySelectorAll('.domain-row, .folder-row');
        folderRows.forEach(row => {
            row.classList.add('collapsed');
            const childUl = row.parentElement.querySelector('.tree-children');
            if (childUl) childUl.style.display = 'none';
        });
    });

    // Initial Tree Load
    loadTreeData();
});
