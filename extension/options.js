/**
 * mediaIndex — Options Page Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  const apiUrlInput = document.getElementById('api-url');
  const userIdInput = document.getElementById('user-id');
  const defaultHint = document.getElementById('default-hint');
  const statusMsg = document.getElementById('status-message');
  const saveBtn = document.getElementById('save-btn');
  const testBtn = document.getElementById('test-btn');
  const resetBtn = document.getElementById('reset-btn');

  const defaultApi = (typeof CONFIG !== 'undefined' && CONFIG.DEFAULT_API_BASE)
    ? CONFIG.DEFAULT_API_BASE
    : 'http://127.0.0.1:5000';

  const defaultUser = (typeof CONFIG !== 'undefined' && CONFIG.DEFAULT_USER_ID)
    ? CONFIG.DEFAULT_USER_ID
    : 'default';

  defaultHint.textContent = `Default: ${defaultApi} (from config.js)`;

  // Load existing settings
  const stored = await chrome.storage.local.get(['apiUrl', 'userId']);
  apiUrlInput.value = stored.apiUrl || defaultApi;
  userIdInput.value = stored.userId || defaultUser;

  function showStatus(text, type = 'info', autoHideMs = 4000) {
    statusMsg.className = `status-box ${type}`;
    statusMsg.textContent = text;
    statusMsg.style.display = 'flex';

    if (autoHideMs > 0) {
      setTimeout(() => {
        statusMsg.style.display = 'none';
      }, autoHideMs);
    }
  }

  // Save settings
  saveBtn.addEventListener('click', async () => {
    let url = apiUrlInput.value.trim();
    const userId = userIdInput.value.trim() || defaultUser;

    if (!url) {
      url = defaultApi;
    }

    // Strip trailing slashes for consistency
    url = url.replace(/\/+$/, '');

    try {
      new URL(url); // Validate URL format
    } catch {
      showStatus('Invalid URL format. Please include protocol (e.g. http:// or https://)', 'error');
      return;
    }

    await chrome.storage.local.set({
      apiUrl: url,
      userId: userId
    });

    showStatus(`✓ Settings saved! API Base set to: ${url}`, 'success');
  });

  // Test connection
  testBtn.addEventListener('click', async () => {
    let url = apiUrlInput.value.trim() || defaultApi;
    url = url.replace(/\/+$/, '');

    showStatus(`Testing connection to ${url}...`, 'info', 0);
    testBtn.disabled = true;

    try {
      const pingUrl = `${url}${typeof CONFIG !== 'undefined' ? CONFIG.ENDPOINTS.ping : '/api/tree'}`;
      const response = await fetch(pingUrl, {
        signal: AbortSignal.timeout(3500)
      });

      if (response.ok) {
        showStatus(`✓ Connection successful! Backend is online (HTTP ${response.status}).`, 'success');
      } else {
        showStatus(`⚠ Server responded with HTTP ${response.status}. Backend might be misconfigured.`, 'error');
      }
    } catch (err) {
      showStatus(`✕ Could not reach server at ${url} (${err.message})`, 'error');
    } finally {
      testBtn.disabled = false;
    }
  });

  // Reset to default
  resetBtn.addEventListener('click', async () => {
    apiUrlInput.value = defaultApi;
    userIdInput.value = defaultUser;

    await chrome.storage.local.remove(['apiUrl', 'userId']);
    showStatus('✓ Reset to default settings (from config.js).', 'info');
  });
});

