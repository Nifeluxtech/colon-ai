// Workspace data persistence (v0.29.0, Workspace step 5; schema: database/migrations/0024_workspace_data.sql).
// Secrets, collections and records for each workspace. The engine (data.js) checks ownership before calling the
// owner functions; site() is the one public lookup: which workspace (and owner) a published page's key names.
// dataSqlStore() talks to MySQL; dataMemoryStore(wsMemory) is the same interface in memory, for tests.

function dataSqlStore(q) {
  q = q || require('../../db');
  return {
    site: (key) => q.one('SELECT id, user_id FROM colon_workspaces WHERE id = ?', [String(key)]),
    secrets: (wsId) => q.query(`SELECT name, host, send_as, updated_at FROM colon_workspace_secrets
      WHERE workspace_id = ? ORDER BY name`, [wsId]),
    secret: (wsId, name) => q.one(`SELECT name, value_enc, host, send_as FROM colon_workspace_secrets
      WHERE workspace_id = ? AND name = ?`, [wsId, name]),
    putSecret: (wsId, s) => q.query(`INSERT INTO colon_workspace_secrets (workspace_id, name, value_enc, host, send_as,
      updated_at) VALUES (?,?,?,?,?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE value_enc = VALUES(value_enc),
      host = VALUES(host), send_as = VALUES(send_as), updated_at = VALUES(updated_at)`,
    [wsId, s.name, s.value_enc, s.host || null, s.send_as]),
    async deleteSecret(wsId, name) {
      const r = await q.query('DELETE FROM colon_workspace_secrets WHERE workspace_id = ? AND name = ?', [wsId, name]);
      return r.affectedRows > 0;
    },
    collections: (wsId) => q.query(`SELECT c.name, c.read_rule, c.add_rule, c.created_at,
      (SELECT COUNT(*) FROM colon_workspace_records r WHERE r.workspace_id = c.workspace_id
        AND r.collection = c.name) AS records
      FROM colon_workspace_collections c WHERE c.workspace_id = ? ORDER BY c.name`, [wsId]),
    collection: (wsId, name) => q.one(`SELECT name, read_rule, add_rule FROM colon_workspace_collections
      WHERE workspace_id = ? AND name = ?`, [wsId, name]),
    putCollection: (wsId, c) => q.query(`INSERT INTO colon_workspace_collections (workspace_id, name, read_rule,
      add_rule, created_at) VALUES (?,?,?,?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE read_rule = VALUES(read_rule),
      add_rule = VALUES(add_rule)`, [wsId, c.name, c.read_rule, c.add_rule]),
    async deleteCollection(wsId, name) {
      await q.query('DELETE FROM colon_workspace_records WHERE workspace_id = ? AND collection = ?', [wsId, name]);
      const r = await q.query('DELETE FROM colon_workspace_collections WHERE workspace_id = ? AND name = ?',
        [wsId, name]);
      return r.affectedRows > 0;
    },
    async countRecords(wsId) {
      const r = await q.one('SELECT COUNT(*) AS n FROM colon_workspace_records WHERE workspace_id = ?', [wsId]);
      return Number(r && r.n) || 0;
    },
    records: (wsId, name, before, limit) => q.query(`SELECT id, data, created_at FROM colon_workspace_records
      WHERE workspace_id = ? AND collection = ? AND id < ? ORDER BY id DESC LIMIT ${Number(limit)}`,
    [wsId, name, before || Number.MAX_SAFE_INTEGER]),
    async addRecord(wsId, name, data) {
      const r = await q.query(`INSERT INTO colon_workspace_records (workspace_id, collection, data, created_at)
        VALUES (?,?,?, UTC_TIMESTAMP(3))`, [wsId, name, data]);
      return Number(r.insertId);
    },
    async deleteRecord(wsId, name, id) {
      const r = await q.query(`DELETE FROM colon_workspace_records WHERE workspace_id = ? AND collection = ?
        AND id = ?`, [wsId, name, Number(id)]);
      return r.affectedRows > 0;
    },
    // v0.30.0: connected services (connect.js), config as JSON
    connections: (wsId) => q.query(`SELECT provider, config, updated_at FROM colon_workspace_connections
      WHERE workspace_id = ? ORDER BY provider`, [wsId]),
    putConnection: (wsId, provider, config) => q.query(`INSERT INTO colon_workspace_connections (workspace_id,
      provider, config, updated_at) VALUES (?,?,?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE config = VALUES(config),
      updated_at = VALUES(updated_at)`, [wsId, provider, config]),
    async deleteConnection(wsId, provider) {
      const r = await q.query('DELETE FROM colon_workspace_connections WHERE workspace_id = ? AND provider = ?',
        [wsId, provider]);
      return r.affectedRows > 0;
    },
  };
}

function dataMemoryStore(wsMemory) {
  const s = { secrets: [], collections: [], records: [], next: 1 };
  const now = () => new Date();
  const of = (list, wsId) => list.filter((x) => x.workspace_id === wsId);
  const live = (wsId) => Boolean(wsMemory && wsMemory._s.ws.find((w) => w.id === wsId));
  return {
    _s: s,
    async site(key) {
      const w = wsMemory && wsMemory._s.ws.find((x) => x.id === String(key));
      return w ? { id: w.id, user_id: w.user_id } : null;
    },
    async secrets(wsId) {
      return live(wsId) ? of(s.secrets, wsId).map(({ name, host, send_as, updated_at }) => ({ name, host, send_as,
        updated_at })).sort((a, b) => (a.name < b.name ? -1 : 1)) : [];
    },
    async secret(wsId, name) { return of(s.secrets, wsId).find((x) => x.name === name) || null; },
    async putSecret(wsId, x) {
      s.secrets = s.secrets.filter((y) => !(y.workspace_id === wsId && y.name === x.name));
      s.secrets.push({ workspace_id: wsId, ...x, host: x.host || null, updated_at: now() });
    },
    async deleteSecret(wsId, name) {
      const n = s.secrets.length;
      s.secrets = s.secrets.filter((y) => !(y.workspace_id === wsId && y.name === name));
      return s.secrets.length < n;
    },
    async collections(wsId) {
      return of(s.collections, wsId).map((c) => ({ ...c, records: of(s.records, wsId)
        .filter((r) => r.collection === c.name).length })).sort((a, b) => (a.name < b.name ? -1 : 1));
    },
    async collection(wsId, name) { return of(s.collections, wsId).find((c) => c.name === name) || null; },
    async putCollection(wsId, c) {
      const had = of(s.collections, wsId).find((x) => x.name === c.name);
      if (had) { had.read_rule = c.read_rule; had.add_rule = c.add_rule; return; }
      s.collections.push({ workspace_id: wsId, name: c.name, read_rule: c.read_rule, add_rule: c.add_rule,
        created_at: now() });
    },
    async deleteCollection(wsId, name) {
      s.records = s.records.filter((r) => !(r.workspace_id === wsId && r.collection === name));
      const n = s.collections.length;
      s.collections = s.collections.filter((c) => !(c.workspace_id === wsId && c.name === name));
      return s.collections.length < n;
    },
    async countRecords(wsId) { return of(s.records, wsId).length; },
    async records(wsId, name, before, limit) {
      return of(s.records, wsId).filter((r) => r.collection === name && r.id < (before || Infinity))
        .sort((a, b) => b.id - a.id).slice(0, limit).map(({ id, data, created_at }) => ({ id, data, created_at }));
    },
    async addRecord(wsId, name, data) {
      const id = s.next++;
      s.records.push({ id, workspace_id: wsId, collection: name, data, created_at: now() });
      return id;
    },
    async deleteRecord(wsId, name, id) {
      const n = s.records.length;
      s.records = s.records.filter((r) => !(r.workspace_id === wsId && r.collection === name && r.id === Number(id)));
      return s.records.length < n;
    },
    async connections(wsId) {
      return of(s.conns || [], wsId).sort((a, b) => (a.provider < b.provider ? -1 : 1));
    },
    async putConnection(wsId, provider, config) {
      s.conns = (s.conns || []).filter((c) => !(c.workspace_id === wsId && c.provider === provider));
      s.conns.push({ workspace_id: wsId, provider, config, updated_at: now() });
    },
    async deleteConnection(wsId, provider) {
      const n = (s.conns || []).length;
      s.conns = (s.conns || []).filter((c) => !(c.workspace_id === wsId && c.provider === provider));
      return s.conns.length < n;
    },
  };
}

module.exports = { dataSqlStore, dataMemoryStore };
