/**
 * media index — Options Page Controller
 * Streamlined Developer Mode toggle and health check diagnostics.
 */

document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  // DOM Elements
  const devToggle = document.getElementById('dev-toggle');
  const devContainer = document.getElementById('dev-container');
  const devApiUrlInput = document.getElementById('dev-api-url');
  const envDesc = document.getElementById('env-desc');
  const presetBtns = document.querySelectorAll('.preset-pill');

  const pingDot = document.getElementById('ping-dot');
  const pingMsg = document.getElementById('ping-msg');
  const statusMsg = document.getElementById('status-message');

  const testBtn = document.getElementById('test-btn');
  const saveBtn = document.getElementById('save-btn');
  const resetBtn = document.getElementById('reset-btn');

  // Runtime State
  let coldStartTimer = null;
  let isPollingColdStart = false;

  const prodApi = (typeof CONFIG !== 'undefined' && CONFIG.PRODUCTION_API_BASE)
    ? CONFIG.PRODUCTION_API_BASE
    : 'https://media-index.onrender.com';

  const defaultDevApi = (typeof CONFIG !== 'undefined' && CONFIG.DEFAULT_DEV_API_BASE)
    ? CONFIG.DEFAULT_DEV_API_BASE
    : 'http://127.0.0.1:5000';

  function normalizeUrl(rawUrl, fallback = defaultDevApi) {
    let clean = (rawUrl || '').trim();
    if (!clean) return fallback;
    if (!/^https?:\/\//i.test(clean)) {
      clean = 'http://' + clean;
    }
    return clean.replace(/\/+$/, '');
  }

  function showStatus(text, type = 'info', autoHideMs = 4500) {
    if (!statusMsg) return;
    statusMsg.className = `status-box ${type}`;
    statusMsg.textContent = text;
    statusMsg.style.display = 'flex';

    if (autoHideMs > 0) {
      setTimeout(() => {
        if (statusMsg) statusMsg.style.display = 'none';
      }, autoHideMs);
    }
  }

  function updatePing(state, message = '', latencyMs = null) {
    // state: 'online' | 'offline' | 'waking'
    if (pingDot && pingMsg) {
      pingDot.className = `ping-dot ${state}`;
      pingMsg.className = `ping-msg ${state}`;

      if (state === 'online') {
        pingMsg.textContent = latencyMs !== null
          ? `Connected (${latencyMs}ms latency) — Online`
          : `Connected — ${message || 'Online'}`;
      } else if (state === 'waking') {
        pingMsg.textContent = message || 'Starting up server (may take a moment)...';
      } else {
        pingMsg.textContent = message || 'Offline or unreachable';
      }
    }
  }

  // -------------------------------------------------------------
  // 1. Developer Mode & Environment
  // -------------------------------------------------------------
  async function initEnvironmentUI() {
    const stored = await chrome.storage.local.get(['devModeEnabled', 'devApiUrl']);
    const isDev = !!stored.devModeEnabled;
    const devUrl = stored.devApiUrl || defaultDevApi;

    if (devToggle) devToggle.checked = isDev;
    if (devApiUrlInput) devApiUrlInput.value = devUrl;
    if (devContainer) devContainer.style.display = isDev ? 'flex' : 'none';
    if (saveBtn) saveBtn.style.display = isDev ? 'inline-flex' : 'none';

    if (envDesc) {
      envDesc.textContent = isDev
        ? `Local Server (${devUrl})`
        : `Connected to Live Server`;
    }

    testServerConnection();
  }

  if (devToggle) {
    devToggle.addEventListener('change', async () => {
      const enabled = devToggle.checked;
      const currentDevUrl = normalizeUrl(devApiUrlInput.value, defaultDevApi);

      if (devContainer) devContainer.style.display = enabled ? 'flex' : 'none';
      if (saveBtn) saveBtn.style.display = enabled ? 'inline-flex' : 'none';
      if (envDesc) {
        envDesc.textContent = enabled
          ? `Local Server (${currentDevUrl})`
          : `Connected to Live Server`;
      }

      await chrome.storage.local.set({
        devModeEnabled: enabled,
        devApiUrl: currentDevUrl,
        apiUrl: enabled ? currentDevUrl : prodApi
      });

      showStatus(
        enabled ? `Switched to Local Developer Mode.` : `Connected to Live Server.`,
        'info',
        3000
      );

      testServerConnection();
    });
  }

  presetBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetUrl = btn.getAttribute('data-url');
      if (devApiUrlInput) devApiUrlInput.value = targetUrl;
      if (envDesc) envDesc.textContent = `Local Server (${targetUrl})`;

      await chrome.storage.local.set({
        devModeEnabled: true,
        devApiUrl: targetUrl,
        apiUrl: targetUrl
      });

      if (devToggle) devToggle.checked = true;
      if (devContainer) devContainer.style.display = 'flex';
      if (saveBtn) saveBtn.style.display = 'inline-flex';

      showStatus(`Local server URL updated to ${targetUrl}`, 'info', 2000);
      testServerConnection();
    });
  });

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const clean = normalizeUrl(devApiUrlInput.value, defaultDevApi);
      devApiUrlInput.value = clean;
      await chrome.storage.local.set({ devApiUrl: clean, apiUrl: clean });
      if (envDesc) envDesc.textContent = `Local Server (${clean})`;
      showStatus(`✓ Local server URL saved: ${clean}`, 'success', 2500);
      testServerConnection();
    });
  }

  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      showStatus('Testing connection...', 'info', 0);
      const ok = await testServerConnection();
      testBtn.disabled = false;
      if (ok) {
        showStatus('✓ Connection successful! Server is online.', 'success');
      } else {
        showStatus('✕ Could not reach server. Verify connection or check if server is running.', 'error');
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (devToggle) devToggle.checked = false;
      if (devContainer) devContainer.style.display = 'none';
      if (saveBtn) saveBtn.style.display = 'none';
      if (devApiUrlInput) devApiUrlInput.value = defaultDevApi;
      if (envDesc) envDesc.textContent = `Connected to Live Server`;

      await chrome.storage.local.set({
        devModeEnabled: false,
        devApiUrl: defaultDevApi,
        apiUrl: prodApi
      });

      showStatus('Reset to Live Server default.', 'info');
      testServerConnection();
    });
  }

  // -------------------------------------------------------------
  // 2. Health Check Diagnostics & Cold-Start Recovery
  // -------------------------------------------------------------
  async function testServerConnection() {
    const stored = await chrome.storage.local.get(['devModeEnabled', 'devApiUrl', 'apiUrl']);
    let targetUrl = prodApi;

    if (typeof CONFIG !== 'undefined' && typeof CONFIG.resolveApiUrl === 'function') {
      targetUrl = CONFIG.resolveApiUrl(stored);
    } else if (stored.devModeEnabled) {
      targetUrl = stored.devApiUrl || defaultDevApi;
    }

    targetUrl = targetUrl.replace(/\/+$/, '');

    const isCloud = (typeof CONFIG !== 'undefined' && typeof CONFIG.isCloudHost === 'function')
      ? CONFIG.isCloudHost(targetUrl)
      : targetUrl.includes('onrender.com');

    const start = performance.now();

    try {
      const res = await fetch(`${targetUrl}/api/tree`, {
        signal: AbortSignal.timeout(3500)
      });
      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        stopColdStartPoll();
        updatePing('online', 'Server Online', latency);
        return true;
      }
    } catch {}

    if (isCloud) {
      updatePing('waking', 'Connecting to cloud server (may take a moment)...');
      if (!isPollingColdStart) {
        startColdStartPoll(targetUrl);
      }
      return false;
    }

    stopColdStartPoll();
    updatePing('offline', `Cannot reach ${targetUrl}`);
    return false;
  }

  function startColdStartPoll(targetUrl) {
    isPollingColdStart = true;
    let attempts = 0;
    const maxAttempts = 15;

    if (coldStartTimer) clearInterval(coldStartTimer);

    coldStartTimer = setInterval(async () => {
      attempts++;
      try {
        const ping = await fetch(`${targetUrl}/api/tree`, {
          signal: AbortSignal.timeout(3800)
        });
        if (ping.ok) {
          stopColdStartPoll();
          testServerConnection();
          return;
        }
      } catch {}

      if (attempts >= maxAttempts) {
        stopColdStartPoll();
        updatePing('offline', 'Server timed out after 60s');
      }
    }, 4000);
  }

  function stopColdStartPoll() {
    isPollingColdStart = false;
    if (coldStartTimer) {
      clearInterval(coldStartTimer);
      coldStartTimer = null;
    }
  }

  // Initialization
  await initEnvironmentUI();
});
