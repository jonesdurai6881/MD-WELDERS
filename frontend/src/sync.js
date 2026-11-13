import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { repository } from './database.js';
import { secureGet, secureRemove, secureSet } from './secure-storage.js';

const STATE_KEY = 'mdwelders.syncState';
const CURSOR_KEY = 'mdwelders.syncCursor';
const ACCESS_TOKEN_KEY = 'mdwelders.sync.accessToken';
const REFRESH_TOKEN_KEY = 'mdwelders.sync.refreshToken';
const DEVICE_ID_KEY = 'mdwelders.sync.deviceId';
const BUSINESS_ID_KEY = 'mdwelders.sync.businessId';
const BASE_RETRY_MS = 5000;
const MAX_RETRY_MS = 15 * 60 * 1000;

let activeSync;
let refreshInFlight;
let nativeOnline = true;
let automaticStarted = false;
let automaticTimer;
let retryTimer;
let localChangeTimer;
let uploaded = 0;
let downloaded = 0;
let progress = { phase: 'idle', completed: 0, total: 0 };

function apiBase() {
  const configured = import.meta.env?.VITE_API_BASE_URL;
  return configured ? configured.replace(/\/+$/, '') : '';
}

function validatedApiBase() {
  const base = apiBase();
  if (!base) throw new Error('Cloud sync is not configured. Set VITE_API_BASE_URL to the Spring Boot API address.');
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error('Cloud sync URL is invalid. Configure a valid HTTPS Spring Boot API address.');
  }
  const localHost = ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(import.meta.env?.DEV && localHost && url.protocol === 'http:')) {
    throw new Error('Cloud sync requires HTTPS. HTTP is allowed only for a local development server.');
  }
  return base;
}

function isOnline() {
  return nativeOnline && globalThis.navigator?.onLine !== false;
}

function requestTimeout() {
  return AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined;
}

function readSavedState() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(STATE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveState(values) {
  try {
    globalThis.localStorage?.setItem(STATE_KEY, JSON.stringify({ ...readSavedState(), ...values }));
  } catch (error) {
    console.warn('Sync status could not be persisted on this device.', error);
  }
}

function readCursor() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(CURSOR_KEY) || '{"updatedAt":"1970-01-01T00:00:00Z","entityType":"","recordId":""}');
  } catch {
    return { updatedAt: '1970-01-01T00:00:00Z', entityType: '', recordId: '' };
  }
}

function boundBusinessId() {
  try {
    return globalThis.localStorage?.getItem(BUSINESS_ID_KEY) || '';
  } catch (error) {
    throw new Error(`The local business-account binding could not be read: ${error.message}`);
  }
}

function bindBusinessId(businessId) {
  try {
    if (!globalThis.localStorage) throw new Error('Persistent local storage is unavailable.');
    globalThis.localStorage.setItem(BUSINESS_ID_KEY, businessId);
  } catch (error) {
    throw new Error(`The local business-account binding could not be saved: ${error.message}`);
  }
}

function saveCursor(cursor) {
  try {
    globalThis.localStorage?.setItem(CURSOR_KEY, JSON.stringify(cursor));
  } catch (error) {
    throw new Error(`Cloud updates were applied locally, but the sync cursor could not be saved: ${error.message}`);
  }
}

function dispatchProgress(next) {
  progress = next;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mdwelders:sync-progress', { detail: progress }));
    window.dispatchEvent(new Event('mdwelders:sync-status'));
  }
}

async function queueCounts() {
  const pending = await repository().pending();
  return {
    pending: pending.filter(change => change.status === 'pending').length,
    failed: pending.filter(change => change.status === 'failed').length,
    conflicts: pending.filter(change => change.status === 'conflict').length
  };
}

async function getDeviceIdentity() {
  let deviceId = await secureGet(DEVICE_ID_KEY);
  if (!Capacitor.isNativePlatform()) {
    try {
      deviceId = globalThis.localStorage?.getItem(DEVICE_ID_KEY) || deviceId;
    } catch (error) {
      console.warn('A stable browser device ID could not be loaded.', error);
    }
  }
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await secureSet(DEVICE_ID_KEY, deviceId);
    if (!Capacitor.isNativePlatform()) {
      try {
        globalThis.localStorage?.setItem(DEVICE_ID_KEY, deviceId);
      } catch (error) {
        console.warn('A stable browser device ID could not be saved.', error);
      }
    }
  }
  const platform = Capacitor.getPlatform();
  return { deviceId, deviceName: `MD WELDERS ${platform} device`, platform };
}

async function storedSession() {
  const [accessToken, refreshToken] = await Promise.all([
    secureGet(ACCESS_TOKEN_KEY),
    secureGet(REFRESH_TOKEN_KEY)
  ]);
  return { accessToken, refreshToken };
}

async function clearSession() {
  await Promise.all([
    secureRemove(ACCESS_TOKEN_KEY),
    secureRemove(REFRESH_TOKEN_KEY)
  ]);
  saveState({ authStatus: 'signed-out' });
}

async function parseResponse(response) {
  try {
    return await response.json();
  } catch {
    throw new Error('The server returned an invalid response.');
  }
}

function serverError(payload, statusCode) {
  const detail = typeof payload?.message === 'string' ? payload.message.slice(0, 300) : '';
  return detail || `The server returned ${statusCode}.`;
}

async function revokeLoginSession(base, accessToken) {
  let response;
  try {
    response = await fetch(`${base}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: requestTimeout()
    });
  } catch {
    throw new Error('The new business-account session could not be revoked after this device rejected the account. Ask a business administrator to revoke this device.');
  }
  if (!response.ok) {
    throw new Error(`The new business-account session could not be revoked (${response.status}). Ask a business administrator to revoke this device.`);
  }
}

function dispatchStatus() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('mdwelders:sync-status'));
  }
}

export async function connectSync(username, password) {
  const base = validatedApiBase();
  if (!isOnline()) throw new Error('You are offline. Connect to the internet before signing in to sync.');
  if (!String(username || '').trim() || !String(password || '')) throw new Error('Enter your sync username and password.');
  const device = await getDeviceIdentity();
  let response;
  try {
    response = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: String(username).trim(), password, ...device }),
      signal: requestTimeout()
    });
  } catch {
    throw new Error('Could not reach the secure sign-in service. Your local records remain safe.');
  }
  const payload = await parseResponse(response);
  if (!response.ok) throw new Error(`Sync sign-in failed: ${serverError(payload, response.status)}`);
  if (typeof payload.accessToken !== 'string' || typeof payload.refreshToken !== 'string' || typeof payload.businessId !== 'string') {
    throw new Error('The sign-in service did not return valid session tokens and a business account ID.');
  }
  const existingBusinessId = boundBusinessId();
  if (existingBusinessId && existingBusinessId !== payload.businessId) {
    await revokeLoginSession(base, payload.accessToken);
    throw new Error('This device already contains local records bound to another business account. Use a separate device or safely export and reset its local data before connecting a different business.');
  }
  try {
    await secureSet(ACCESS_TOKEN_KEY, payload.accessToken);
    await secureSet(REFRESH_TOKEN_KEY, payload.refreshToken);
    if (!existingBusinessId) bindBusinessId(payload.businessId);
  } catch (error) {
    const cleanupErrors = [];
    try {
      await revokeLoginSession(base, payload.accessToken);
    } catch (revokeError) {
      cleanupErrors.push(revokeError.message);
    }
    try {
      await clearSession();
    } catch (clearError) {
      cleanupErrors.push(`Local session cleanup failed: ${clearError.message}`);
    }
    const cleanup = cleanupErrors.length ? ` ${cleanupErrors.join(' ')}` : '';
    throw new Error(`The device could not securely store its sync session: ${error.message}.${cleanup}`);
  }
  saveState({ authStatus: 'signed-in', lastError: '' });
  dispatchStatus();
  return { deviceId: device.deviceId, expiresAt: payload.expiresAt || '' };
}

async function refreshSession(base, refreshToken, deviceId) {
  let response;
  try {
    response = await fetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken, deviceId }),
      signal: requestTimeout()
    });
  } catch {
    throw new Error('Could not refresh the secure sync session. Local changes remain queued.');
  }
  const payload = await parseResponse(response);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) await clearSession();
    throw new Error(`Sync session refresh failed: ${serverError(payload, response.status)}`);
  }
  if (typeof payload.accessToken !== 'string' || typeof payload.refreshToken !== 'string' || typeof payload.businessId !== 'string') {
    await clearSession();
    throw new Error('The server returned an invalid refreshed session.');
  }
  const existingBusinessId = boundBusinessId();
  if (existingBusinessId && existingBusinessId !== payload.businessId) {
    await clearSession();
    throw new Error('The sync session belongs to a different business account than this device’s local records.');
  }
  if (!existingBusinessId) bindBusinessId(payload.businessId);
  await secureSet(ACCESS_TOKEN_KEY, payload.accessToken);
  await secureSet(REFRESH_TOKEN_KEY, payload.refreshToken);
  saveState({ authStatus: 'signed-in', lastError: '' });
  return payload.accessToken;
}

function refreshSessionOnce(base, refreshToken, deviceId) {
  if (!refreshInFlight) {
    refreshInFlight = refreshSession(base, refreshToken, deviceId).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function authorizedFetch(base, path, options = {}) {
  const session = await storedSession();
  if (!session.accessToken || !session.refreshToken) throw new Error('Connect this device to your business account before syncing.');
  const device = await getDeviceIdentity();
  const send = token => fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    signal: options.signal || requestTimeout()
  });
  let response;
  try {
    response = await send(session.accessToken);
  } catch {
    throw new Error('Sync could not reach the server. Your local changes remain safe and queued.');
  }
  if (response.status !== 401) return response;
  const accessToken = await refreshSessionOnce(base, session.refreshToken, device.deviceId);
  try {
    response = await send(accessToken);
  } catch {
    throw new Error('Sync could not reach the server after refreshing the session. Your local changes remain queued.');
  }
  if (response.status === 401 || response.status === 403) {
    await clearSession();
    throw new Error('This device is no longer authorized to sync. Sign in again or ask a business administrator to restore access.');
  }
  return response;
}

export async function logoutSync() {
  const base = validatedApiBase();
  const session = await storedSession();
  if (!session.accessToken) {
    await clearSession();
    return;
  }
  const response = await authorizedFetch(base, '/api/v1/auth/logout', { method: 'POST' });
  if (!response.ok) throw new Error(`This device could not be signed out on the server (${response.status}).`);
  await clearSession();
  dispatchStatus();
}

export async function registeredDevices() {
  const base = validatedApiBase();
  const response = await authorizedFetch(base, '/api/v1/devices');
  if (!response.ok) throw new Error(`Registered devices could not be loaded (${response.status}).`);
  const payload = await parseResponse(response);
  if (!Array.isArray(payload) && !Array.isArray(payload.devices)) throw new Error('The server returned an invalid device list.');
  return Array.isArray(payload) ? payload : payload.devices;
}

export async function remoteSyncStatus() {
  if (!apiBase() || !isOnline()) return null;
  const base = validatedApiBase();
  const session = await storedSession();
  if (!session.refreshToken) return null;
  const cursor = readCursor();
  const query = new URLSearchParams({
    since: cursor.updatedAt,
    afterEntityType: cursor.entityType,
    afterRecordId: cursor.recordId
  });
  const response = await authorizedFetch(base, `/api/v1/sync/status?${query}`);
  if (!response.ok) throw new Error(`Cloud sync status could not be loaded (${response.status}).`);
  const result = await parseResponse(response);
  if (typeof result.businessId !== 'string' || result.businessId !== boundBusinessId()) {
    await clearSession();
    throw new Error('The sync status belongs to a different business account. This device has been signed out to protect its local records.');
  }
  if (!Number.isFinite(Number(result.availableToDownloadCount))) {
    throw new Error('The sync status response did not include a valid pending-download count.');
  }
  return {
    pendingDownload: Number(result.availableToDownloadCount),
    recordCount: Number(result.recordCount),
    lastUpdatedAt: result.lastUpdatedAt || ''
  };
}

export async function revokeDevice(deviceId) {
  const base = validatedApiBase();
  if (!deviceId) throw new Error('Select a device to revoke.');
  const response = await authorizedFetch(base, `/api/v1/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Device access could not be revoked (${response.status}).`);
  dispatchStatus();
}

export async function syncNow() {
  if (activeSync) return activeSync;
  activeSync = performSync();
  try {
    return await activeSync;
  } catch (error) {
    saveState({ lastError: error.message, status: isOnline() ? 'failed' : 'offline' });
    if (automaticStarted) scheduleRetry();
    dispatchStatus();
    throw error;
  } finally {
    activeSync = null;
    dispatchStatus();
  }
}

async function performSync() {
  const base = validatedApiBase();
  if (!isOnline()) throw new Error('You are offline. Local data is safe and will remain queued until a connection is available.');
  const session = await storedSession();
  if (!session.accessToken || !session.refreshToken) {
    saveState({ status: 'authentication-required', authStatus: 'signed-out' });
    throw new Error('Connect this device to your business account before syncing.');
  }

  saveState({ status: 'syncing', uploaded: 0, downloaded: 0, lastError: '' });
  uploaded = 0;
  downloaded = 0;
  const store = repository();
  const queue = await store.pending();
  const eligible = queue.filter(change => change.status !== 'conflict');
  dispatchProgress({ phase: 'uploading', completed: 0, total: eligible.length });
  saveState({ status: 'syncing', uploadTotal: eligible.length, uploadCompleted: 0, pendingDownload: null });

  for (let offset = 0; offset < eligible.length; offset += 100) {
    const batch = eligible.slice(offset, offset + 100);
    let response;
    try {
      response = await authorizedFetch(base, '/api/v1/sync/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map(change => ({
          idempotencyKey: change.queueId,
          entityType: change.entityType,
          recordId: change.recordId,
          operation: change.operation,
          payload: JSON.parse(change.payload),
          baseVersion: change.baseVersion ?? 0
        })))
      });
    } catch (error) {
      for (const change of batch) {
        await store.syncState(change.queueId, 'failed', error.message, null, null, change.payload);
      }
      throw error;
    }
    if (!response.ok) {
      const error = `Sync upload failed (${response.status}). Local changes remain queued.`;
      for (const change of batch) await store.syncState(change.queueId, 'failed', error, null, null, change.payload);
      throw new Error(error);
    }
    const results = await parseResponse(response);
    if (!Array.isArray(results)) {
      for (const change of batch) await store.syncState(change.queueId, 'failed', 'The server returned an invalid sync response.', null, null, change.payload);
      throw new Error('The server returned an invalid sync response. Local changes remain queued.');
    }

    const processed = new Set();
    for (const result of results) {
      const change = batch.find(item => item.queueId === result.idempotencyKey);
      if (!change) continue;
      processed.add(change.queueId);
      if (result.status === 'APPLIED' && Number.isFinite(Number(result.serverVersion))) {
        await store.syncState(change.queueId, 'synced', null, result.serverVersion, null, change.payload);
        uploaded += 1;
      } else if (result.status === 'CONFLICT') {
        await store.syncState(change.queueId, 'conflict', result.error || 'Cloud record changed since this edit.', null, {
          version: result.serverVersion,
          payload: result.serverPayload,
          deleted: result.serverDeleted
        }, change.payload);
      } else {
        await store.syncState(change.queueId, 'failed', result.error || 'The server did not apply this record.', null, null, change.payload);
      }
    }
    for (const change of batch) {
      if (!processed.has(change.queueId)) {
        await store.syncState(change.queueId, 'failed', 'The server omitted this record from its response.', null, null, change.payload);
      }
    }
    dispatchProgress({ phase: 'uploading', completed: Math.min(offset + batch.length, eligible.length), total: eligible.length });
    saveState({ uploadCompleted: Math.min(offset + batch.length, eligible.length), uploaded });
  }

  let cursor = readCursor();
  dispatchProgress({ phase: 'downloading', completed: 0, total: null });
  while (true) {
    const query = new URLSearchParams({
      since: cursor.updatedAt,
      afterEntityType: cursor.entityType,
      afterRecordId: cursor.recordId,
      limit: '1000'
    });
    const response = await authorizedFetch(base, `/api/v1/sync/changes?${query}`);
    if (!response.ok) throw new Error(`Cloud updates could not be downloaded (${response.status}). Local data remains available; retry sync.`);
    const changes = await parseResponse(response);
    if (!Array.isArray(changes)) throw new Error('Cloud returned an invalid changes response. Local data remains available; retry sync.');
    for (const change of changes) {
      await store.applyRemote(change);
      cursor = { updatedAt: change.updatedAt, entityType: change.entityType, recordId: change.recordId };
      saveCursor(cursor);
    }
    downloaded += changes.length;
    dispatchProgress({ phase: 'downloading', completed: downloaded, total: null });
    saveState({ downloaded });
    if (changes.length < 1000) break;
  }

  const counts = await queueCounts();
  const currentStatus = counts.failed ? 'failed' : counts.pending || counts.conflicts ? 'pending' : 'synced';
  const lastSyncAt = new Date().toISOString();
  saveState({
    status: currentStatus,
    uploaded,
    downloaded,
    pendingDownload: 0,
    failed: counts.failed,
    lastSyncAt,
    lastError: '',
    retryAttempt: 0,
    retryAt: 0
  });
  dispatchProgress({ phase: 'idle', completed: uploaded + downloaded, total: uploaded + downloaded });
  if (counts.pending) scheduleAutomaticSync(250);
  return { applied: uploaded, received: downloaded, conflicts: counts.conflicts, failed: counts.failed, lastSyncAt };
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  const saved = readSavedState();
  const attempt = Number(saved.retryAttempt || 0) + 1;
  const baseDelay = Math.min(BASE_RETRY_MS * (2 ** Math.min(attempt - 1, 8)), MAX_RETRY_MS);
  const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
  const retryAt = Date.now() + delay;
  saveState({ retryAttempt: attempt, retryAt });
  retryTimer = setTimeout(() => {
    retryTimer = null;
    scheduleAutomaticSync(0);
  }, delay);
}

function scheduleAutomaticSync(delay = 0) {
  if (!automaticStarted) return;
  if (automaticTimer) clearTimeout(automaticTimer);
  automaticTimer = setTimeout(() => {
    automaticTimer = null;
    void syncOnReconnect().catch(error => {
      saveState({ lastError: error.message, status: isOnline() ? 'failed' : 'offline' });
      dispatchStatus();
    });
  }, delay);
}

export async function syncOnReconnect() {
  if (!apiBase() || !isOnline() || activeSync) return null;
  const session = await storedSession();
  if (!session.refreshToken) return null;
  return syncNow();
}

function handleOnline() {
  nativeOnline = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  scheduleAutomaticSync(0);
  dispatchStatus();
}

function handleLocalChange() {
  if (localChangeTimer) clearTimeout(localChangeTimer);
  localChangeTimer = setTimeout(() => scheduleAutomaticSync(750), 500);
}

export async function startAutomaticSync() {
  if (automaticStarted) return;
  automaticStarted = true;
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', () => {
      nativeOnline = false;
      saveState({ status: 'offline' });
      dispatchStatus();
    });
    window.addEventListener('mdwelders:local-change', handleLocalChange);
  }
  if (Capacitor.isNativePlatform()) {
    try {
      nativeOnline = (await Network.getStatus()).connected;
      await Network.addListener('networkStatusChange', connection => {
        nativeOnline = connection.connected;
        if (connection.connected) handleOnline();
        else {
          saveState({ status: 'offline' });
          dispatchStatus();
        }
      });
      await App.addListener('appStateChange', state => {
        if (state.isActive) scheduleAutomaticSync(0);
      });
    } catch (error) {
      console.warn('Native connectivity monitoring could not start; browser network events remain enabled.', error);
    }
  }
  const saved = readSavedState();
  if (saved.retryAt > Date.now()) {
    retryTimer = setTimeout(() => {
      retryTimer = null;
      scheduleAutomaticSync(0);
    }, saved.retryAt - Date.now());
  } else {
    scheduleAutomaticSync(0);
  }
}

export async function syncStatus() {
  const counts = await queueCounts();
  const saved = readSavedState();
  const configured = Boolean(apiBase());
  const online = isOnline();
  const session = await storedSession();
  let currentStatus = saved.status || 'pending';
  if (!online) currentStatus = 'offline';
  else if (!configured) currentStatus = 'not-configured';
  else if (!session.refreshToken) currentStatus = 'authentication-required';
  else if (activeSync) currentStatus = 'syncing';
  else if (counts.failed || saved.status === 'failed') currentStatus = 'failed';
  else if (counts.pending || counts.conflicts) currentStatus = 'pending';
  else if (saved.lastSyncAt) currentStatus = 'synced';
  else currentStatus = 'pending';
  const device = await getDeviceIdentity();
  return {
    ...counts,
    configured,
    online,
    authenticated: Boolean(session.refreshToken),
    businessId: boundBusinessId(),
    status: currentStatus,
    lastSyncAt: saved.lastSyncAt || '',
    uploaded: saved.uploaded ?? uploaded,
    downloaded: saved.downloaded ?? downloaded,
    pendingDownload: saved.pendingDownload ?? null,
    lastError: saved.lastError || '',
    progress: activeSync ? progress : { phase: 'idle', completed: 0, total: 0 },
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    lastFailed: counts.failed
  };
}
