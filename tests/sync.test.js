import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeDatabase, repository } from '../frontend/src/database.js';
import { syncNow, syncStatus } from '../frontend/src/sync.js';

test('unconfigured sync reports its real status and leaves local records and queue untouched', async () => {
  await initializeDatabase();
  const store = repository();
  const recordsBefore = await store.list('settings');
  const queueBefore = await store.pending();
  await assert.rejects(syncNow(), /Cloud sync is not configured/);
  const status = await syncStatus();
  assert.equal(status.configured, false);
  assert.equal(status.status, 'not-configured');
  assert.deepEqual(await store.list('settings'), recordsBefore);
  assert.deepEqual(await store.pending(), queueBefore);
});

test('an edit during an upload keeps the newer payload queued with the acknowledged server version', async () => {
  const store = repository();
  const id = crypto.randomUUID();
  const first = { id, name: 'Before upload', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await store.put('settings', first, 0);
  const original = (await store.pending()).find(change => change.recordId === id);

  const latest = { ...first, name: 'Edited during upload', updatedAt: new Date().toISOString() };
  await store.put('settings', latest, 0);
  await store.syncState(original.queueId, 'synced', null, 1, null, original.payload);

  const retry = (await store.pending()).find(change => change.recordId === id);
  assert.ok(retry);
  assert.equal(retry.status, 'pending');
  assert.notEqual(retry.queueId, original.queueId);
  assert.equal(retry.baseVersion, 1);
  assert.equal(JSON.parse(retry.payload).name, 'Edited during upload');
  assert.equal((await store.get('settings', id)).serverVersion, 1);
});

test('keeping a local conflict generates a fresh idempotency key before retry', async () => {
  const store = repository();
  const id = crypto.randomUUID();
  await store.put('settings', { id, name: 'Local setting' }, 0);
  const local = (await store.pending()).find(change => change.recordId === id);
  await store.applyRemote({
    entityType: 'settings',
    recordId: id,
    payload: { id, name: 'Cloud setting' },
    serverVersion: 4,
    deleted: false,
    updatedAt: new Date().toISOString()
  });
  const conflict = (await store.pending()).find(change => change.recordId === id);
  assert.equal(conflict.status, 'conflict');

  await store.resolveConflict(conflict.queueId, 'local');
  const retry = (await store.pending()).find(change => change.recordId === id);
  assert.notEqual(retry.queueId, local.queueId);
  assert.equal(retry.baseVersion, 4);
  assert.equal(retry.status, 'pending');
  assert.equal(JSON.parse(retry.payload).name, 'Local setting');
});
