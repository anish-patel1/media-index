/**
 * media index — Popup Controller
 * Connects active browser tab, content script, and background worker.
 */

document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  // DOM Elements
  const statusIndicator = document.getElementById('connection-status');
  const statusLabel = document.getElementById('status-label');
  const pageTitleEl = document.getElementById('page-title');
  const statsTotalEl = document.getElementById('stats-total');
  const statsBreakdownEl = document.getElementById('stats-breakdown');
  const selectionBar = document.getElementById('selection-bar');
  const selectAllCheckbox = document.getElementById('select-all-checkbox');
  const selectedCountEl = document.getElementById('selected-count');
  const filterPills = document.getElementById('filter-pills');
  const assetsList = document.getElementById('assets-list');
  const scanningState = document.getElementById('scanning-state');
  const emptyState = document.getElementById('empty-state');
  const sendBtn = document.getElementById('send-btn');
  const sendBtnText = document.getElementById('send-btn-text');
  const dashboardLink = document.getElementById('dashboard-link');
  const openSettingsBtn = document.getElementById('open-settings-btn');

  let allAssets = [];
  let currentFilter = 'all';
  const selectedUrls = new Set();
  let hasInitializedSelection = false; // Tracks whether the first auto-select-all has run

  // -------------------------------------------------------------
  // 1. Check Server Connection Status
  // -------------------------------------------------------------
  async function checkServerConnection() {
    try {
      const stored = await chrome.storage.local.get(['apiUrl']);
      const apiBase = stored.apiUrl || (typeof CONFIG !== 'undefined' ? CONFIG.DEFAULT_API_BASE : 'http://127.0.0.1:5000');
      if (dashboardLink) {
        dashboardLink.href = apiBase;
        dashboardLink.title = `Open ${apiBase}`;
      }

      const res = await chrome.runtime.sendMessage({ action: 'CHECK_CONNECTION' });
      if (res && res.connected) {
        statusIndicator.className = 'status-indicator online';
        statusLabel.textContent = 'Server Online';
        statusIndicator.title = `Connected to ${res.apiBase || apiBase}`;
      } else {
        statusIndicator.className = 'status-indicator offline';
        statusLabel.textContent = 'Server Offline';
        statusIndicator.title = `Start backend on ${apiBase} to enable ingestion`;
      }
    } catch {
      statusIndicator.className = 'status-indicator offline';
      statusLabel.textContent = 'Offline';
    }
  }

  // -------------------------------------------------------------
  // 2. Scan Media on Current Active Tab
  // -------------------------------------------------------------
  async function scanActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        showEmptyState('Could not access active tab.');
        return;
      }

      if (tab.title) {
        pageTitleEl.textContent = tab.title;
        pageTitleEl.title = tab.url || tab.title;
      }

      // Special chrome:// or edge:// pages cannot be scripted
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
        showEmptyState('Extensions cannot scan internal browser pages.');
        return;
      }

      // Try sending message to existing content script
      let response = null;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'SCAN_MEDIA' });
      } catch {
        // Content script not yet injected: dynamically inject it
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          // Retry message after injection
          response = await chrome.tabs.sendMessage(tab.id, { action: 'SCAN_MEDIA' });
        } catch (injectErr) {
          console.debug('Script injection note:', injectErr);
        }
      }

      if (response && response.status === 'success' && Array.isArray(response.media)) {
        allAssets = response.media;
        hasInitializedSelection = false; // Reset so fresh scan triggers auto-select-all
        renderAssetList(allAssets);
      } else {
        showEmptyState('No media found on this page.');
      }
    } catch (err) {
      console.error('Scan error:', err);
      showEmptyState('Error scanning page for media.');
    }
  }

  function showEmptyState(msg) {
    if (scanningState) scanningState.style.display = 'none';
    if (emptyState) {
      emptyState.style.display = 'flex';
      const p = emptyState.querySelector('p');
      if (p && msg) p.textContent = msg;
    }
    if (selectionBar) selectionBar.style.display = 'none';
    if (statsTotalEl) statsTotalEl.textContent = '0 assets';
    if (statsBreakdownEl) statsBreakdownEl.textContent = 'None detected';
    if (sendBtn) sendBtn.disabled = true;
  }

  // -------------------------------------------------------------
  // 3. Render Asset Cards & Selection State
  // -------------------------------------------------------------
  function getFilteredAssets() {
    if (currentFilter === 'all') return allAssets;
    return allAssets.filter(item => item.type === currentFilter);
  }

  function updateStatsAndCounts() {
    const total = allAssets.length;
    const imgCount = allAssets.filter(a => a.type === 'image').length;
    const vidCount = allAssets.filter(a => a.type === 'video').length;
    const gifCount = allAssets.filter(a => a.type === 'gif').length;

    statsTotalEl.textContent = `${total} asset${total !== 1 ? 's' : ''}`;
    const parts = [];
    if (imgCount) parts.push(`${imgCount} img`);
    if (vidCount) parts.push(`${vidCount} vid`);
    if (gifCount) parts.push(`${gifCount} gif`);
    statsBreakdownEl.textContent = parts.join(' · ') || 'None';

    const filtered = getFilteredAssets();
    const selectedFilteredCount = filtered.filter(a => selectedUrls.has(a.url)).length;
    selectedCountEl.textContent = selectedFilteredCount;

    selectAllCheckbox.checked = filtered.length > 0 && selectedFilteredCount === filtered.length;
    selectAllCheckbox.indeterminate = selectedFilteredCount > 0 && selectedFilteredCount < filtered.length;

    sendBtn.disabled = selectedUrls.size === 0;
    sendBtnText.textContent = selectedUrls.size > 0 
      ? `Send ${selectedUrls.size} to media index` 
      : 'Select items to send';
  }

  function renderAssetList() {
    if (scanningState) scanningState.style.display = 'none';

    if (!allAssets.length) {
      showEmptyState();
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (selectionBar) selectionBar.style.display = 'flex';

    // Default: select all assets on first load only
    if (!hasInitializedSelection) {
      allAssets.forEach(a => selectedUrls.add(a.url));
      hasInitializedSelection = true;
    }

    const filtered = getFilteredAssets();
    assetsList.innerHTML = '';

    if (!filtered.length) {
      assetsList.innerHTML = `
        <div class="state-message">
          <p>No ${currentFilter.toUpperCase()} assets found on this page.</p>
        </div>
      `;
      updateStatsAndCounts();
      return;
    }

    filtered.forEach(asset => {
      const card = document.createElement('div');
      card.className = 'asset-item';

      const isChecked = selectedUrls.has(asset.url);
      const filename = asset.url.split('/').pop().split('?')[0] || asset.alt || 'media-asset';
      const dimText = asset.width && asset.height ? `${asset.width}×${asset.height}` : '';

      card.innerHTML = `
        <input type="checkbox" data-url="${escapeAttr(asset.url)}" ${isChecked ? 'checked' : ''}>
        <div class="asset-thumb">
          ${asset.type === 'image' || asset.type === 'gif'
            ? `<img src="${escapeAttr(asset.url)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"><span class="type-fallback" style="display:none;">${escapeHtml(asset.extension)}</span>`
            : `<span class="type-fallback">${escapeHtml(asset.extension)}</span>`
          }
        </div>
        <div class="asset-info">
          <div class="asset-name" title="${escapeAttr(filename)}">${escapeHtml(filename)}</div>
          <div class="asset-meta">
            <span class="asset-badge">${escapeHtml(asset.extension)}</span>
            ${dimText ? `<span class="dim-badge">${dimText}</span>` : ''}
          </div>
        </div>
      `;

      const checkbox = card.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedUrls.add(asset.url);
        } else {
          selectedUrls.delete(asset.url);
        }
        updateStatsAndCounts();
      });

      assetsList.appendChild(card);
    });

    updateStatsAndCounts();
  }

  // Escape helpers
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/"/g, '&quot;');
  }

  // -------------------------------------------------------------
  // 4. Filter Pills & Select All Handlers
  // -------------------------------------------------------------
  if (filterPills) {
    filterPills.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;

      filterPills.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      currentFilter = btn.getAttribute('data-filter') || 'all';
      renderAssetList();
    });
  }

  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', () => {
      const filtered = getFilteredAssets();
      if (selectAllCheckbox.checked) {
        filtered.forEach(a => selectedUrls.add(a.url));
      } else {
        filtered.forEach(a => selectedUrls.delete(a.url));
      }
      renderAssetList();
    });
  }

  // -------------------------------------------------------------
  // 5. Send Selected to media index Backend
  // -------------------------------------------------------------
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      const urlsToSend = Array.from(selectedUrls);
      if (!urlsToSend.length) return;

      sendBtn.disabled = true;
      sendBtnText.textContent = `Sending ${urlsToSend.length} assets...`;

      try {
        const response = await chrome.runtime.sendMessage({
          action: 'SUBMIT_URLS',
          urls: urlsToSend
        });

        if (response && response.status === 'success') {
          const imported = response.imported ?? urlsToSend.length;
          const merged = response.merged ?? 0;
          sendBtnText.textContent = `✓ Ingested ${imported} Media Items!`;
          sendBtn.style.background = '#10b981';

          setTimeout(() => {
            sendBtnText.textContent = `Send ${selectedUrls.size} to media index`;
            sendBtn.style.background = '';
            sendBtn.disabled = false;
          }, 3000);
        } else {
          sendBtnText.textContent = response.message || 'Submission failed';
          sendBtn.style.background = '#ef4444';
          setTimeout(() => {
            sendBtnText.textContent = `Send ${selectedUrls.size} to media index`;
            sendBtn.style.background = '';
            sendBtn.disabled = false;
          }, 3500);
        }
      } catch (err) {
        console.error('Submission error:', err);
        sendBtnText.textContent = 'Server communication error';
        sendBtn.style.background = '#ef4444';
        setTimeout(() => {
          sendBtnText.textContent = `Send ${selectedUrls.size} to media index`;
          sendBtn.style.background = '';
          sendBtn.disabled = false;
        }, 3500);
      }
    });
  }

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open('options.html');
      }
    });
  }

  // Initial sequence
  await checkServerConnection();
  await scanActiveTab();
});
