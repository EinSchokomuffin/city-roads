const path = require('path');
const express = require('express');
const Datastore = require('nedb-promises');

const app = express();
const port = Number.parseInt(process.env.PORT || '8081', 10);
const dbFilePath = process.env.MAP_STATE_DB_PATH || path.join(__dirname, 'data', 'map-state.db');

const store = Datastore.create({
  filename: dbFilePath,
  autoload: true,
  timestampData: true
});

store.ensureIndex({
  fieldName: 'scopeKey',
  unique: true
}).catch((e) => {
  console.error('Failed to ensure DB index for scopeKey:', e);
});

app.use(express.json({limit: '1mb'}));

app.get('/api/health', (req, res) => {
  res.json({ok: true});
});

app.get('/api/map-state', async (req, res) => {
  try {
    const scope = normalizeScope(req.query || {});
    const scopeKey = getScopeKey(scope);
    const record = await store.findOne({scopeKey});
    if (!record) {
      return res.status(404).json({found: false});
    }

    return res.json({
      found: true,
      payload: record.payload,
      updatedAt: record.updatedAt || null
    });
  } catch (e) {
    console.error('GET /api/map-state failed:', e);
    return res.status(500).json({error: 'failed_to_read_map_state'});
  }
});

app.post('/api/map-state', async (req, res) => {
  try {
    const incoming = req.body || {};
    const payload = incoming && typeof incoming === 'object' ? incoming : null;
    if (!payload) {
      return res.status(400).json({error: 'invalid_payload'});
    }

    const scope = normalizeScope(payload.scope || req.query || {});
    payload.scope = scope;

    const scopeKey = getScopeKey(scope);
    await store.update(
      {scopeKey},
      {
        scopeKey,
        scope,
        payload
      },
      {upsert: true}
    );

    return res.status(204).end();
  } catch (e) {
    console.error('POST /api/map-state failed:', e);
    return res.status(500).json({error: 'failed_to_write_map_state'});
  }
});

app.listen(port, () => {
  console.log(`[map-state-api] running on http://localhost:${port}`);
  console.log(`[map-state-api] db file: ${dbFilePath}`);
});

function normalizeScope(raw) {
  return {
    areaId: asScopeString(raw.areaId),
    osmId: asScopeString(raw.osmId),
    name: asScopeString(raw.name || raw.q)
  };
}

function asScopeString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function getScopeKey(scope) {
  if (scope.areaId) return `area:${scope.areaId}`;
  if (scope.osmId) return `osm:${scope.osmId}`;
  if (scope.name) return `q:${scope.name.toLowerCase()}`;
  return 'default';
}
