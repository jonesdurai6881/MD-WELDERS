import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';

const TABLES = [
  'employees', 'customers', 'workOrders', 'assignments', 'salaryPayments',
  'materials', 'stockTransactions', 'bills', 'customerPayments', 'expenses',
  'aiProposals', 'settings'
];
const DB_NAME = 'md_welders';
const DB_VERSION = 2;
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const remotePayload = payload => typeof payload === 'string' ? JSON.parse(payload) : payload;
let driver;

function notifyLocalChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('mdwelders:local-change'));
}

async function openNative() {
  const connection = new SQLiteConnection(CapacitorSQLite);
  const db = await connection.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
  await db.open();
  const statements = [
    ...TABLES.map(table => `CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0);`),
    'CREATE TABLE IF NOT EXISTS sync_outbox (queue_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, record_id TEXT NOT NULL, operation TEXT NOT NULL, payload TEXT NOT NULL, base_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'pending\', error TEXT, remote_version INTEGER, remote_payload TEXT, remote_deleted INTEGER NOT NULL DEFAULT 0, UNIQUE(entity_type, record_id));',
    'CREATE TABLE IF NOT EXISTS local_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);'
  ];
  await db.execute(statements.join('\n'), true);
  const outboxColumns = await db.query('PRAGMA table_info(sync_outbox)');
  const columnNames = new Set(outboxColumns.values.map(column => column.name));
  const migrations = [
    ['remote_version', 'INTEGER'],
    ['remote_payload', 'TEXT'],
    ['remote_deleted', 'INTEGER NOT NULL DEFAULT 0']
  ];
  for (const [name, definition] of migrations) {
    if (!columnNames.has(name)) await db.execute(`ALTER TABLE sync_outbox ADD COLUMN ${name} ${definition}`, true);
  }

  const tableName = table => {
    if (!TABLES.includes(table)) throw new Error('Unsupported local data type.');
    return `"${table}"`;
  };
  const sql = (statement, transaction = true) => db.execute(statement, transaction);
  const saveStatements = (table, record, baseVersion) => {
    const payload = JSON.stringify(record);
    const queueId = crypto.randomUUID();
    const now = new Date().toISOString();
    const deleted = record.deleted ? 1 : 0;
    return [
      `INSERT INTO ${tableName(table)}(id,data,updated_at,version,deleted) VALUES (${quote(record.id)},${quote(payload)},${quote(now)},1,${deleted}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,version=${tableName(table)}.version+1,deleted=excluded.deleted;`,
      `INSERT INTO sync_outbox(queue_id,entity_type,record_id,operation,payload,base_version,created_at,status) VALUES (${quote(queueId)},${quote(table)},${quote(record.id)},${quote(deleted ? 'DELETE' : 'UPSERT')},${quote(payload)},${baseVersion},${quote(now)},'pending') ON CONFLICT(entity_type,record_id) DO UPDATE SET operation=excluded.operation,payload=excluded.payload,created_at=excluded.created_at,status='pending',error=NULL;`
    ];
  };
  return {
    async list(table, includeDeleted = false) {
      const result = await db.query(`SELECT data FROM ${tableName(table)} ${includeDeleted ? '' : 'WHERE deleted = 0'}`);
      return result.values.map(row => JSON.parse(row.data));
    },
    async get(table, id) {
      const result = await db.query(`SELECT data FROM ${tableName(table)} WHERE id = ${quote(id)} AND deleted = 0`);
      return result.values.length ? JSON.parse(result.values[0].data) : null;
    },
    async put(table, record, baseVersion = 0) {
      await sql(saveStatements(table, record, baseVersion).join('\n'), true);
      notifyLocalChange();
    },
    async putMany(records) {
      const statements = records.flatMap(({ table, record, baseVersion = 0 }) => saveStatements(table, record, baseVersion));
      await sql(statements.join('\n'), true);
      notifyLocalChange();
    },
    async pending() {
      const result = await db.query('SELECT * FROM sync_outbox WHERE status IN (\'pending\',\'failed\',\'conflict\') ORDER BY created_at');
      return result.values.map(row => ({
        ...row,
        queueId: row.queue_id,
        entityType: row.entity_type,
        recordId: row.record_id,
        baseVersion: row.base_version,
        remoteVersion: row.remote_version,
        remotePayload: row.remote_payload,
        remoteDeleted: Boolean(row.remote_deleted)
      }));
    },
    async syncState(queueId, status, error = null, version = null, remote = null, expectedPayload = null) {
      const selected = await db.query('SELECT entity_type,record_id,payload,base_version FROM sync_outbox WHERE queue_id = ?', [queueId]);
      const row = selected.values[0];
      const updates = [];
      let savedPayload = row?.payload;
      if (version !== null && row) {
        const selectedRecord = await db.query(`SELECT data FROM "${row.entity_type}" WHERE id = ?`, [row.record_id]);
        const saved = selectedRecord.values.length ? JSON.parse(selectedRecord.values[0].data) : null;
        if (saved) {
          saved.serverVersion = version;
          savedPayload = JSON.stringify(saved);
          updates.push(`UPDATE "${row.entity_type}" SET data=${quote(savedPayload)},version=version+1 WHERE id=${quote(row.record_id)};`);
        }
      }
      const changedDuringSync = expectedPayload !== null && row && row.payload !== expectedPayload;
      if (changedDuringSync && status !== 'conflict') {
        const newQueueId = crypto.randomUUID();
        const nextBaseVersion = version === null ? row.base_version : version;
        updates.push(`UPDATE sync_outbox SET queue_id=${quote(newQueueId)},base_version=${Number(nextBaseVersion)},payload=${quote(savedPayload)},status='pending',error=NULL,remote_version=NULL,remote_payload=NULL,remote_deleted=0 WHERE queue_id=${quote(queueId)};`);
      } else if (status === 'synced') updates.push(`DELETE FROM sync_outbox WHERE queue_id=${quote(queueId)};`);
      else updates.push(`UPDATE sync_outbox SET status=${quote(status)},error=${error === null ? 'NULL' : quote(error)}${remote ? `,remote_version=${Number(remote.version)},remote_payload=${quote(JSON.stringify(remote.payload))},remote_deleted=${remote.deleted ? 1 : 0}` : ''} WHERE queue_id=${quote(queueId)};`);
      if (updates.length) await sql(updates.join('\n'), true);
    },
    async resolveConflict(queueId, resolution) {
      const selected = await db.query('SELECT * FROM sync_outbox WHERE queue_id = ? AND status = \'conflict\'', [queueId]);
      const queued = selected.values[0];
      if (!queued || !['cloud', 'local'].includes(resolution) || queued.remote_version === null) {
        throw new Error('This conflict is no longer available to resolve.');
      }
      const table = tableName(queued.entity_type);
      if (resolution === 'cloud') {
        const remote = queued.remote_payload ? JSON.parse(queued.remote_payload) : {};
        const record = {
          ...remote,
          id: queued.record_id,
          serverVersion: queued.remote_version,
          ...(queued.remote_deleted ? { deleted: true, deletedAt: nowIso() } : {})
        };
        await sql(`INSERT INTO ${table}(id,data,updated_at,version,deleted) VALUES (${quote(record.id)},${quote(JSON.stringify(record))},${quote(nowIso())},${queued.remote_version},${queued.remote_deleted ? 1 : 0}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,version=excluded.version,deleted=excluded.deleted;\nDELETE FROM sync_outbox WHERE queue_id=${quote(queueId)};`, true);
        return;
      }
      const localResult = await db.query(`SELECT data FROM ${table} WHERE id = ?`, [queued.record_id]);
      if (!localResult.values.length) throw new Error('The local copy is missing. Choose the cloud version instead.');
      const local = JSON.parse(localResult.values[0].data);
      local.serverVersion = queued.remote_version;
      const payload = JSON.stringify(local);
      await sql(`UPDATE ${table} SET data=${quote(payload)} WHERE id=${quote(queued.record_id)};\nUPDATE sync_outbox SET queue_id=${quote(crypto.randomUUID())},base_version=${Number(queued.remote_version)},payload=${quote(payload)},status='pending',error=NULL,remote_version=NULL,remote_payload=NULL,remote_deleted=0 WHERE queue_id=${quote(queueId)};`, true);
      notifyLocalChange();
    },
    async applyRemote(change) {
      if (!TABLES.includes(change.entityType)) throw new Error('Unsupported remote record type.');
      const localQueue = await db.query(
        'SELECT queue_id FROM sync_outbox WHERE entity_type = ? AND record_id = ?',
        [change.entityType, change.recordId]);
      if (localQueue.values.length) {
        await db.run(
          "UPDATE sync_outbox SET status='conflict',error=?,remote_version=?,remote_payload=?,remote_deleted=? WHERE entity_type=? AND record_id=?",
          ['A newer cloud version requires review.', change.serverVersion, JSON.stringify(change.payload || {}), change.deleted ? 1 : 0, change.entityType, change.recordId]);
        return;
      }
      const existing = await this.get(change.entityType, change.recordId);
      if (existing) {
        existing.serverVersion = change.serverVersion;
        if (change.deleted) {
          existing.deleted = true;
          existing.deletedAt = change.updatedAt || nowIso();
        } else {
          const remote = remotePayload(change.payload);
          Object.assign(existing, remote, { serverVersion: change.serverVersion });
          delete existing.deleted;
        }
        const payload = JSON.stringify(existing);
        await sql(`UPDATE "${change.entityType}" SET data=${quote(payload)},updated_at=${quote(change.updatedAt || nowIso())},version=version+1,deleted=${existing.deleted ? 1 : 0} WHERE id=${quote(change.recordId)};`, true);
      } else if (!change.deleted) {
        const remote = remotePayload(change.payload);
        const payload = JSON.stringify({ ...remote, id: change.recordId, serverVersion: change.serverVersion });
        await sql(`INSERT INTO "${change.entityType}"(id,data,updated_at,version,deleted) VALUES (${quote(change.recordId)},${quote(payload)},${quote(change.updatedAt || nowIso())},${change.serverVersion},0);`, true);
      }
    },
    async replaceAll(data) {
      const statements = TABLES.flatMap(table => [
        `DELETE FROM "${table}";`,
        ...(data[table] || []).flatMap(record => {
          const createdAt = nowIso();
          const deleted = record.deleted ? 1 : 0;
          return [
            `INSERT INTO "${table}"(id,data,updated_at,version,deleted) VALUES (${quote(record.id)},${quote(JSON.stringify(record))},${quote(record.updatedAt || createdAt)},${Number(record.version || 1)},${deleted});`,
            `INSERT INTO sync_outbox(queue_id,entity_type,record_id,operation,payload,base_version,created_at,status) VALUES (${quote(crypto.randomUUID())},${quote(table)},${quote(record.id)},${quote(deleted ? 'DELETE' : 'UPSERT')},${quote(JSON.stringify(record))},${Number(record.serverVersion || 0)},${quote(createdAt)},'pending');`
          ];
        })
      ]);
      statements.unshift('DELETE FROM sync_outbox;');
      await sql(statements.join('\n'), true);
      notifyLocalChange();
    },
    async backup() {
      const result = {};
      for (const table of TABLES) result[table] = await this.list(table, true);
      return result;
    },
    async clearQueue() { await sql('DELETE FROM sync_outbox;', true); }
  };
}

function nowIso() { return new Date().toISOString(); }

function openBrowser() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const table of TABLES) {
        if (!request.result.objectStoreNames.contains(table)) request.result.createObjectStore(table, { keyPath: 'id' });
      }
      if (!request.result.objectStoreNames.contains('sync_outbox')) {
        const outbox = request.result.createObjectStore('sync_outbox', { keyPath: 'queueId' });
        outbox.createIndex('byRecord', ['entityType', 'recordId'], { unique: true });
        outbox.createIndex('byStatus', 'status');
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = (stores, mode = 'readonly') => db.transaction(stores, mode);
      resolve({
        async list(table, includeDeleted = false) {
          const rows = await requestValue(transaction([table]).objectStore(table).getAll());
          return includeDeleted ? rows : rows.filter(row => !row.deleted);
        },
        async get(table, id) {
          const row = await requestValue(transaction([table]).objectStore(table).get(id));
          return row && !row.deleted ? row : null;
        },
        async put(table, record, baseVersion = 0) {
          const tx = transaction([table, 'sync_outbox'], 'readwrite');
          const current = await requestValue(tx.objectStore(table).get(record.id));
          const saved = { ...record, version: (current?.version || 0) + 1 };
          tx.objectStore(table).put(saved);
          const outbox = tx.objectStore('sync_outbox');
          const index = outbox.index('byRecord');
          const existing = await requestValue(index.get([table, record.id]));
          outbox.put({
            queueId: existing?.queueId || crypto.randomUUID(),
            entityType: table,
            recordId: record.id,
            operation: record.deleted ? 'DELETE' : 'UPSERT',
            payload: JSON.stringify(saved),
            baseVersion: existing?.baseVersion ?? baseVersion,
            createdAt: nowIso(),
            status: 'pending',
            error: null
          });
          await transactionDone(tx);
          notifyLocalChange();
          return saved;
        },
        async putMany(entries) {
          const names = [...new Set(entries.flatMap(() => [...TABLES, 'sync_outbox']))];
          const tx = transaction(names, 'readwrite');
          for (const { table, record, baseVersion = 0 } of entries) {
            if (!TABLES.includes(table)) throw new Error('Unsupported local data type.');
            const records = tx.objectStore(table);
            const current = await requestValue(records.get(record.id));
            const saved = { ...record, version: (current?.version || 0) + 1 };
            records.put(saved);
            const outbox = tx.objectStore('sync_outbox');
            const index = outbox.index('byRecord');
            const existing = await requestValue(index.get([table, record.id]));
            outbox.put({
              queueId: existing?.queueId || crypto.randomUUID(),
              entityType: table,
              recordId: record.id,
              operation: record.deleted ? 'DELETE' : 'UPSERT',
              payload: JSON.stringify(saved),
              baseVersion: existing?.baseVersion ?? baseVersion,
              createdAt: nowIso(),
              status: 'pending',
              error: null
            });
          }
          await transactionDone(tx);
          notifyLocalChange();
        },
        async pending() {
          const rows = await requestValue(transaction(['sync_outbox']).objectStore('sync_outbox').getAll());
          return rows.filter(row => ['pending', 'failed', 'conflict'].includes(row.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        },
        async syncState(queueId, status, error = null, version = null, remote = null, expectedPayload = null) {
          const tx = transaction(['sync_outbox', ...TABLES], 'readwrite');
          const store = tx.objectStore('sync_outbox');
          const row = await requestValue(store.get(queueId));
          let saved = null;
          if (row && version !== null) {
            const records = tx.objectStore(row.entityType);
            const record = await requestValue(records.get(row.recordId));
            if (record) {
              saved = { ...record, serverVersion: version };
              records.put(saved);
            }
          }
          if (row) {
            const changedDuringSync = expectedPayload !== null && row.payload !== expectedPayload;
            if (changedDuringSync && status !== 'conflict') {
              store.delete(queueId);
              store.put({
                ...row,
                queueId: crypto.randomUUID(),
                payload: JSON.stringify(saved || JSON.parse(row.payload)),
                baseVersion: version === null ? row.baseVersion : version,
                status: 'pending',
                error: null,
                remoteVersion: null,
                remotePayload: null,
                remoteDeleted: false
              });
            } else if (status === 'synced') store.delete(queueId);
            else store.put({ ...row, status, error, ...(remote ? { remoteVersion: remote.version, remotePayload: JSON.stringify(remote.payload), remoteDeleted: remote.deleted } : {}) });
          }
          await transactionDone(tx);
        },
        async resolveConflict(queueId, resolution) {
          const outboxTx = transaction(['sync_outbox'], 'readonly');
          const queued = await requestValue(outboxTx.objectStore('sync_outbox').get(queueId));
          await transactionDone(outboxTx);
          if (!queued || queued.status !== 'conflict' || !['cloud', 'local'].includes(resolution) || queued.remoteVersion === undefined) {
            throw new Error('This conflict is no longer available to resolve.');
          }
          const tx = transaction([queued.entityType, 'sync_outbox'], 'readwrite');
          const records = tx.objectStore(queued.entityType);
          const outbox = tx.objectStore('sync_outbox');
          if (resolution === 'cloud') {
            const remoteRecord = queued.remotePayload ? JSON.parse(queued.remotePayload) : {};
            records.put({
              ...remoteRecord,
              id: queued.recordId,
              serverVersion: queued.remoteVersion,
              ...(queued.remoteDeleted ? { deleted: true, deletedAt: nowIso() } : {})
            });
            outbox.delete(queueId);
          } else {
            const local = await requestValue(records.get(queued.recordId));
            if (!local) throw new Error('The local copy is missing. Choose the cloud version instead.');
            const updated = { ...local, serverVersion: queued.remoteVersion };
            records.put(updated);
            const nextQueueId = crypto.randomUUID();
            outbox.delete(queueId);
            outbox.put({
              ...queued,
              queueId: nextQueueId,
              payload: JSON.stringify(updated),
              baseVersion: queued.remoteVersion,
              status: 'pending',
              error: null,
              remoteVersion: null,
              remotePayload: null,
              remoteDeleted: false
            });
          }
          await transactionDone(tx);
          if (resolution === 'local') notifyLocalChange();
        },
        async applyRemote(change) {
          if (!TABLES.includes(change.entityType)) throw new Error('Unsupported remote record type.');
          const tx = transaction([change.entityType, 'sync_outbox'], 'readwrite');
          const records = tx.objectStore(change.entityType);
          const outbox = tx.objectStore('sync_outbox');
          const queued = await requestValue(outbox.index('byRecord').get([change.entityType, change.recordId]));
          if (queued) {
            queued.status = 'conflict';
            queued.error = 'A newer cloud version requires review.';
            queued.remoteVersion = change.serverVersion;
            queued.remotePayload = JSON.stringify(change.payload || {});
            queued.remoteDeleted = Boolean(change.deleted);
            outbox.put(queued);
          } else if (change.deleted) {
            const existing = await requestValue(records.get(change.recordId));
            if (existing) records.put({
              ...existing,
              deleted: true,
              deletedAt: change.updatedAt || nowIso(),
              serverVersion: change.serverVersion
            });
          } else {
            const remoteRecord = typeof change.payload === 'string' ? JSON.parse(change.payload) : change.payload;
            records.put({ ...remoteRecord, id: change.recordId, serverVersion: change.serverVersion });
          }
          await transactionDone(tx);
          notifyLocalChange();
        },
        async replaceAll(data) {
          const tx = transaction([...TABLES, 'sync_outbox'], 'readwrite');
          const outbox = tx.objectStore('sync_outbox');
          outbox.clear();
          for (const table of TABLES) {
            const store = tx.objectStore(table);
            store.clear();
            for (const record of data[table] || []) {
              store.put(record);
              outbox.put({
                queueId: crypto.randomUUID(),
                entityType: table,
                recordId: record.id,
                operation: record.deleted ? 'DELETE' : 'UPSERT',
                payload: JSON.stringify(record),
                baseVersion: Number(record.serverVersion || 0),
                createdAt: nowIso(),
                status: 'pending',
                error: null
              });
            }
          }
          await transactionDone(tx);
        },
        async backup() {
          const result = {};
          for (const table of TABLES) result[table] = await this.list(table, true);
          return result;
        },
        async clearQueue() {
          const tx = transaction(['sync_outbox'], 'readwrite');
          tx.objectStore('sync_outbox').clear();
          await transactionDone(tx);
        }
      });
    };
  });
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Local database transaction was aborted.'));
  });
}

export async function initializeDatabase() {
  if (driver) return driver;
  driver = Capacitor.isNativePlatform() ? await openNative() : await openBrowser();
  return driver;
}

export function repository() {
  if (!driver) throw new Error('Local database has not been initialized.');
  return driver;
}
