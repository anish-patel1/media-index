/**
 * media index — Popup Controller
 * Connects active browser tab, content script, and background worker.
 * Features Smart Environment Routing (Dev Mode) and Cold-Start Recovery.
 */

document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  // -------------------------------------------------------------
  // DOM Elements: Views & Navigation
  // -------------------------------------------------------------
  const scannerView = document.getElementById('scanner-view');
  const settingsView = document.getElementById('settings-view');
  const openSettingsBtn = document.getElementById('open-settings-btn');
  const backToScannerBtn = document.getElementById('back-to-scanner-btn');

  // DOM Elements: Scanner View
  const statusIndicator = document.getElementById('connection-status');
  const statusLabel = document.getElementById('status-label');
  const coldStartBanner = document.getElementById('cold-start-banner');
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

  // DOM Elements: Settings View
  const settingsMiniBadge = document.getElementById('settings-mini-badge');
  const envStatusText = document.getElementById('env-status-text');
  const devModeToggle = document.getElementById('dev-mode-toggle');
  const devModeContainer = document.getElementById('dev-mode-container');
  const settingsDevUrl = document.getElementById('settings-dev-url');
  const portPresetBtns = document.querySelectorAll('.port-preset-btn');
  const pingDot = document.getElementById('ping-dot');
  const pingText = document.getElementById('ping-text');
  const settingsStatusBox = document.getElementById('settings-status-box');
  const settingsSaveBtn = document.getElementById('settings-save-btn');
  const settingsTestBtn = document.getElementById('settings-test-btn');
  const settingsResetBtn = document.getElementById('settings-reset-btn');

  // Runtime State
  let allAssets = [];
  let currentFilter = 'all';
  const selectedUrls = new Set();
  let hasInitializedSelection = false;
  let coldStartPollTimer = null;
  let isColdStartPolling = false;

  const prodApi = (typeof CONFIG !== 'undefined' && CONFIG.PRODUCTION_API_BASE)
    ? CONFIG.PRODUCTION_API_BASE
    : 'https://media-index.onrender.com';

  const defaultDevApi = (typeof CONFIG !== 'undefined' && CONFIG.DEFAULT_DEV_API_BASE)
    ? CONFIG.DEFAULT_DEV_API_BASE
    : 'http://127.0.0.1:5000';

  // -------------------------------------------------------------
  // Helpers: URL Sanitization & Status Display
  // -------------------------------------------------------------
  function normalizeUrl(rawUrl, fallback = defaultDevApi) {
    let clean = (rawUrl || '').trim();
    if (!clean) return fallback;
    if (!/^https?:\/\//i.test(clean)) {
      clean = 'http://' + clean;
    }
    return clean.replace(/\/+$/, '');
  }

  function showSettingsStatus(text, type = 'info', autoHideMs = 3500) {
    if (!settingsStatusBox) return;
    settingsStatusBox.className = `settings-status-box ${type}`;
    settingsStatusBox.textContent = text;
    settingsStatusBox.style.display = 'flex';

    if (autoHideMs > 0) {
      setTimeout(() => {
        if (settingsStatusBox) settingsStatusBox.style.display = 'none';
      }, autoHideMs);
    }
  }

  function updatePingDisplay(state, message = '', latencyMs = null) {
    // state: 'online' | 'offline' | 'waking'
    if (pingDot && pingText) {
      pingDot.className = `ping-dot ${state}`;
      pingText.className = `ping-text ${state}`;

      if (state === 'online') {
        pingText.textContent = latencyMs !== null
          ? `Connected (${latencyMs}ms latency)`
          : `Connected — ${message || 'Online'}`;
      } else if (state === 'waking') {
        pingText.textContent = message || 'Starting up server (may take a moment)...';
      } else {
        pingText.textContent = message || 'Offline or unreachable';
      }
    }

    if (settingsMiniBadge) {
      settingsMiniBadge.className = `settings-badge ${state}`;
      if (state === 'online') {
        settingsMiniBadge.textContent = latencyMs !== null ? `${latencyMs}ms` : 'Online';
      } else if (state === 'waking') {
        settingsMiniBadge.textContent = 'Connecting...';
      } else {
        settingsMiniBadge.textContent = 'Offline';
      }
    }
  }

  // -------------------------------------------------------------
  // 1. Navigation: Slide Transitions
  // -------------------------------------------------------------
  function showScannerView() {
    settingsView.className = 'popup-view view-hidden-right';
    scannerView.className = 'popup-view view-active';
    checkServerConnection();
  }

  function showSettingsView() {
    scannerView.className = 'popup-view view-hidden-left';
    settingsView.className = 'popup-view view-active';
    initSettingsView();
  }

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showSettingsView();
    });
  }

  if (backToScannerBtn) {
    backToScannerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showScannerView();
    });
  }

  // -------------------------------------------------------------
  // 2. Settings View & Developer Mode Controller
  // -------------------------------------------------------------
  async function initSettingsView() {
    const stored = await chrome.storage.local.get(['devModeEnabled', 'devApiUrl']);
    const isDev = !!stored.devModeEnabled;
    const devUrl = stored.devApiUrl || defaultDevApi;

    if (devModeToggle) {
      devModeToggle.checked = isDev;
    }
    if (settingsDevUrl) {
      settingsDevUrl.value = devUrl;
    }
    if (devModeContainer) {
      devModeContainer.style.display = isDev ? 'flex' : 'none';
    }
    if (settingsSaveBtn) {
      settingsSaveBtn.style.display = isDev ? 'block' : 'none';
    }
    if (envStatusText) {
      envStatusText.textContent = isDev
        ? `Local Server (${devUrl})`
        : `Live Server`;
    }

    checkServerConnection();
  }

  // Dev Mode Switch Toggle Listener
  if (devModeToggle) {
    devModeToggle.addEventListener('change', async () => {
      const enabled = devModeToggle.checked;
      const currentDevUrl = normalizeUrl(settingsDevUrl.value, defaultDevApi);

      if (devModeContainer) {
        devModeContainer.style.display = enabled ? 'flex' : 'none';
      }
      if (settingsSaveBtn) {
        settingsSaveBtn.style.display = enabled ? 'block' : 'none';
      }
      if (envStatusText) {
        envStatusText.textContent = enabled
          ? `Local Server (${currentDevUrl})`
          : `Live Server`;
      }

      await chrome.storage.local.set({
        devModeEnabled: enabled,
        devApiUrl: currentDevUrl
      });

      showSettingsStatus(
        enabled ? `Switched to Local Developer Mode` : `Connected to Live Server`,
        'info',
        2500
      );

      checkServerConnection(true);
    });
  }

  // Quick Preset Port Buttons
  portPresetBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.getAttribute('data-url');
      if (settingsDevUrl) settingsDevUrl.value = url;
      if (envStatusText) envStatusText.textContent = `Local Server (${url})`;

      await chrome.storage.local.set({
        devModeEnabled: true,
        devApiUrl: url
      });

      if (devModeToggle) devModeToggle.checked = true;
      if (devModeContainer) devModeContainer.style.display = 'flex';
      if (settingsSaveBtn) settingsSaveBtn.style.display = 'block';

      showSettingsStatus(`Switched local server to ${url}`, 'info', 2000);
      checkServerConnection(true);
    });
  });

  // Save Dev URL Button
  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', async () => {
      const clean = normalizeUrl(settingsDevUrl.value, defaultDevApi);
      settingsDevUrl.value = clean;
      await chrome.storage.local.set({ devApiUrl: clean });
      if (envStatusText) envStatusText.textContent = `Local Server (${clean})`;
      showSettingsStatus(`✓ Local server URL saved: ${clean}`, 'success', 2500);
      checkServerConnection(true);
    });
  }

  // Test Connection Button
  if (settingsTestBtn) {
    settingsTestBtn.addEventListener('click', async () => {
      settingsTestBtn.disabled = true;
      showSettingsStatus('Testing connection...', 'info', 0);
      const ok = await checkServerConnection(true);
      settingsTestBtn.disabled = false;
      if (ok) {
        showSettingsStatus('✓ Connection successful! Server is online.', 'success');
      } else {
        showSettingsStatus('✕ Could not reach server. Verify connection or check if server is running.', 'error');
      }
    });
  }

  // Reset to Defaults Button
  if (settingsResetBtn) {
    settingsResetBtn.addEventListener('click', async () => {
      if (devModeToggle) devModeToggle.checked = false;
      if (devModeContainer) devModeContainer.style.display = 'none';
      if (settingsSaveBtn) settingsSaveBtn.style.display = 'none';
      if (settingsDevUrl) settingsDevUrl.value = defaultDevApi;
      if (envStatusText) envStatusText.textContent = `Live Server`;

      await chrome.storage.local.set({
        devModeEnabled: false,
        devApiUrl: defaultDevApi
      });

      showSettingsStatus('Reset to Live Server default.', 'info');
      checkServerConnection(true);
    });
  }

  // -------------------------------------------------------------
  // 3. Connection Check with Cold-Start Polling Engine
  // -------------------------------------------------------------
  async function checkServerConnection(force = false) {
    const stored = await chrome.storage.local.get(['devModeEnabled', 'devApiUrl', 'apiUrl']);
    let activeUrl = prodApi;

    if (typeof CONFIG !== 'undefined' && typeof CONFIG.resolveApiUrl === 'function') {
      activeUrl = CONFIG.resolveApiUrl(stored);
    } else if (stored.devModeEnabled) {
      activeUrl = stored.devApiUrl || defaultDevApi;
    }

    activeUrl = activeUrl.replace(/\/+$/, '');

    if (dashboardLink) {
      dashboardLink.href = activeUrl;
      dashboardLink.title = `Open ${activeUrl}`;
    }

    const isCloud = (typeof CONFIG !== 'undefined' && typeof CONFIG.isCloudHost === 'function')
      ? CONFIG.isCloudHost(activeUrl)
      : activeUrl.includes('onrender.com');

    const start = performance.now();

    // 1. Quick initial ping (3.5s timeout) using /api/tree
    try {
      const res = await fetch(`${activeUrl}/api/tree`, {
        signal: AbortSignal.timeout(3500)
      });
      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        stopColdStartPoll();

        if (statusIndicator) statusIndicator.className = 'status-indicator online';
        if (statusLabel) statusLabel.textContent = 'Server Online';
        if (statusIndicator) statusIndicator.title = `Connected (${latency}ms)`;
        if (coldStartBanner) coldStartBanner.style.display = 'none';

        updatePingDisplay('online', 'Server Online', latency);
        return true;
      }
    } catch (e) {
      // Quick ping failed or timed out
    }

    // 2. Cold Start Handling for Cloud Server
    if (isCloud) {
      if (statusIndicator) statusIndicator.className = 'status-indicator waking';
      if (statusLabel) statusLabel.textContent = 'Connecting...';
      if (coldStartBanner) coldStartBanner.style.display = 'flex';

      updatePingDisplay('waking', 'Connecting to cloud server (may take a moment)...');

      if (!isColdStartPolling) {
        startColdStartPoll(activeUrl);
      }
      return false;
    }

    // 3. Normal Offline Handling (for Local Server)
    stopColdStartPoll();
    if (statusIndicator) statusIndicator.className = 'status-indicator offline';
    if (statusLabel) statusLabel.textContent = 'Server Offline';
    if (coldStartBanner) coldStartBanner.style.display = 'none';
    if (statusIndicator) statusIndicator.title = `Cannot reach ${activeUrl}`;

    updatePingDisplay('offline', 'Cannot reach local server');
    return false;
  }

  function startColdStartPoll(targetUrl) {
    isColdStartPolling = true;
    let attempts = 0;
    const maxAttempts = 15; // 15 * 4s = 60s max budget

    if (coldStartPollTimer) clearInterval(coldStartPollTimer);

    coldStartPollTimer = setInterval(async () => {
      attempts++;
      try {
        const ping = await fetch(`${targetUrl}/api/tree`, {
          signal: AbortSignal.timeout(3800)
        });
        if (ping.ok) {
          stopColdStartPoll();
          checkServerConnection();
          return;
        }
      } catch {}

      if (attempts >= maxAttempts) {
        stopColdStartPoll();
        if (statusIndicator) statusIndicator.className = 'status-indicator offline';
        if (statusLabel) statusLabel.textContent = 'Server Unreachable';
        if (coldStartBanner) coldStartBanner.style.display = 'none';
        updatePingDisplay('offline', 'Server timed out after 60s');
      }
    }, 4000);
  }

  function stopColdStartPoll() {
    isColdStartPolling = false;
    if (coldStartPollTimer) {
      clearInterval(coldStartPollTimer);
      coldStartPollTimer = null;
    }
  }

  // -------------------------------------------------------------
  // 4. Scan Media on Current Active Tab
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

      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
        showEmptyState('Extensions cannot scan internal browser pages.');
        return;
      }

      let response = null;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'SCAN_MEDIA' });
      } catch {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          response = await chrome.tabs.sendMessage(tab.id, { action: 'SCAN_MEDIA' });
        } catch (injectErr) {
          console.debug('Script injection note:', injectErr);
        }
      }

      if (response && response.status === 'success' && Array.isArray(response.media)) {
        allAssets = response.media;
        hasInitializedSelection = false;
        renderAssetList();
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
  // 5. Render Asset Cards & Selection State
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
      const isSequenced = /(?:^|[_.-])\d+/.test(filename);

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
            ${isSequenced ? '<span class="sibling-chip" title="Numeric sequence pattern detected">✨ Seq</span>' : ''}
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
  // 6. Filter Pills & Select All Handlers
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
  // 7. Send Selected to media index Backend
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

  // Initial sequence
  await checkServerConnection();
  await scanActiveTab();
});
