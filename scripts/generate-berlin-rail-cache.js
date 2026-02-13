const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, '..', 'static', 'berlin', 'rail');
const BERLIN_BBOX = '52.338,13.088,52.675,13.761';
const CACHE_FILE = path.join(OUT_DIR, 'rail_cache_v1.json');

const backends = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/cgi/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter'
];

const tasks = [
  {
    name: 'route_subway.json',
    query: `[out:json][timeout:120][bbox:${BERLIN_BBOX}];(relation[route="subway"];);out body;>;out body;`
  },
  {
    name: 'route_light_rail.json',
    query: `[out:json][timeout:120][bbox:${BERLIN_BBOX}];(relation[route="light_rail"];);out body;>;out body;`
  },
  {
    name: 'rail_rail.json',
    query: `[out:json][timeout:120][bbox:${BERLIN_BBOX}];(way[railway="rail"];);(._;>;);out body;`
  },
  {
    name: 'stations.json',
    query: `[out:json][timeout:120][bbox:${BERLIN_BBOX}];(
      node[railway="station"];
      node[public_transport="station"];
      node[station];
    );out body;`
  },
  {
    name: 'border.json',
    query: `[out:json][timeout:120];relation[boundary="administrative"][admin_level="4"][name="Berlin"];out body;>;out body;`
  }
];

ensureDir(OUT_DIR);

run().catch(err => {
  console.error(err);
  process.exit(1);
});

async function run() {
  for (const task of tasks) {
    console.log(`Fetching ${task.name}...`);
    const data = await postOverpass(task.query);
    const outPath = path.join(OUT_DIR, task.name);
    fs.writeFileSync(outPath, JSON.stringify(data));
    console.log(`Saved ${outPath}`);
    await delay(1500);
  }

  const railCache = buildRailCache();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(railCache));
  console.log(`Saved ${CACHE_FILE}`);
}

function buildRailCache() {
  const routeSubway = readJson(path.join(OUT_DIR, 'route_subway.json'));
  const routeLightRail = readJson(path.join(OUT_DIR, 'route_light_rail.json'));
  const stations = readJson(path.join(OUT_DIR, 'stations.json'));
  const border = readJson(path.join(OUT_DIR, 'border.json'));

  const sbahnSegmentsByColor = buildRouteSegmentsByColor(routeLightRail, 'sbahn', 'light_rail', '#006F35');
  const ubahnSegmentsByColor = buildRouteSegmentsByColor(routeSubway, 'ubahn', 'subway', '#115D91');
  const borderSegments = buildBorderSegments(border);
  const stopPoints = mergeStopPoints([
    buildStopPoints(routeLightRail),
    buildStopPoints(routeSubway)
  ]);
  const majorStations = buildStations(stations, stopPoints);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    bbox: BERLIN_BBOX,
    rail: {
      sbahn: {
        color: '#006F35',
        lineWidth: 2,
        segmentsByColor: sbahnSegmentsByColor
      },
      ubahn: {
        color: '#115D91',
        lineWidth: 2,
        segmentsByColor: ubahnSegmentsByColor
      }
    },
    stations: {
      all: majorStations
    },
    border: {
      segments: borderSegments
    }
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildRouteSegmentsByColor(osmResponse, infoId, routeType, fallbackColor) {
  if (!osmResponse || !osmResponse.elements) return {};

  const relations = osmResponse.elements.filter(el => el.type === 'relation' && el.tags && el.tags.route === routeType);
  const ways = osmResponse.elements.filter(el => el.type === 'way');
  const nodes = osmResponse.elements.filter(el => el.type === 'node');

  const nodeMap = new Map(nodes.map(n => [n.id, {lon: Number(n.lon), lat: Number(n.lat)}]));
  const wayMap = new Map(ways.map(w => [w.id, w]));
  const segmentsByColor = new Map();

  relations.forEach(rel => {
    const wayIds = new Set((rel.members || []).filter(m => m.type === 'way').map(m => m.ref));
    if (!wayIds.size) return;
    const ref = (rel.tags && (rel.tags.ref || rel.tags.name)) || routeType;
    const color = pickLineColor(infoId, ref, pickRouteColor(rel.tags, fallbackColor));
    let segments = segmentsByColor.get(color);
    if (!segments) {
      segments = [];
      segmentsByColor.set(color, segments);
    }
    wayIds.forEach(wayId => {
      const way = wayMap.get(wayId);
      if (!way || !way.nodes) return;
      const points = way.nodes.map(id => nodeMap.get(id)).filter(Boolean);
      const simplified = downsample(points);
      for (let i = 1; i < simplified.length; i++) {
        const a = simplified[i - 1];
        const b = simplified[i];
        segments.push([a.lon, a.lat, b.lon, b.lat]);
      }
    });
  });

  const result = {};
  for (const [color, segments] of segmentsByColor.entries()) {
    result[color] = segments;
  }
  return result;
}

function buildBorderSegments(osmResponse) {
  if (!osmResponse || !osmResponse.elements) return [];

  const relations = osmResponse.elements.filter(el => el.type === 'relation');
  const ways = osmResponse.elements.filter(el => el.type === 'way');
  const nodes = osmResponse.elements.filter(el => el.type === 'node');

  const nodeMap = new Map(nodes.map(n => [n.id, {lon: Number(n.lon), lat: Number(n.lat)}]));
  const wayMap = new Map(ways.map(w => [w.id, w]));
  const segments = [];

  relations.forEach(rel => {
    const members = rel.members || [];
    let wayMembers = members.filter(m => m.type === 'way' && m.role === 'outer');
    if (!wayMembers.length) wayMembers = members.filter(m => m.type === 'way');
    const wayIds = new Set(wayMembers.map(m => m.ref));
    wayIds.forEach(wayId => {
      const way = wayMap.get(wayId);
      if (!way || !way.nodes) return;
      const points = way.nodes.map(id => nodeMap.get(id)).filter(Boolean);
      const simplified = downsample(points);
      for (let i = 1; i < simplified.length; i++) {
        const a = simplified[i - 1];
        const b = simplified[i];
        segments.push([a.lon, a.lat, b.lon, b.lat]);
      }
    });
  });

  return segments;
}

function buildStations(osmResponse, stopPoints) {
  if (!osmResponse || !osmResponse.elements) return [];
  const nodes = osmResponse.elements.filter(el => el.type === 'node');
  const stations = [];
  const stopIndex = createStopIndex(stopPoints, 0.002);

  nodes.forEach(node => {
    const tags = node.tags || {};
    const isMajor = tags.station === 'major' || tags.station === 'interchange' || tags.railway === 'station';

    let color = '#FFFFFF';
    if (tags.station === 'subway' || tags.subway === 'yes') color = '#115D91';
    else if (tags.network && tags.network.includes('S-Bahn')) color = '#006F35';
    else if (tags.railway === 'station') color = '#EC6608';

    const name = tags.name || tags['name:de'] || tags['name:en'] || tags.ref || 'Unbenannt';
    const lines = pickLinesForStation(stopIndex, node, 150);

    stations.push({
      lon: Number(node.lon),
      lat: Number(node.lat),
      color,
      name,
      isMajor,
      lines
    });
  });

  return stations;
}

function buildStopPoints(osmResponse) {
  if (!osmResponse || !osmResponse.elements) return [];

  const relations = osmResponse.elements.filter(el => el.type === 'relation' && el.tags && el.tags.route);
  const nodes = osmResponse.elements.filter(el => el.type === 'node');
  const nodeMap = new Map(nodes.map(n => [n.id, {lon: Number(n.lon), lat: Number(n.lat)}]));
  const result = [];

  relations.forEach(rel => {
    const ref = rel.tags.ref || rel.tags.name;
    if (!ref) return;
    const cleanRef = String(ref).trim();
    if (!cleanRef) return;

    const members = rel.members || [];
    members.forEach(member => {
      if (!member || member.type !== 'node') return;
      const node = nodeMap.get(member.ref);
      if (!node) return;
      result.push({
        lon: node.lon,
        lat: node.lat,
        line: cleanRef
      });
    });
  });

  return result;
}

function mergeStopPoints(pointsList) {
  const merged = new Map();
  pointsList.forEach(points => {
    points.forEach(point => {
      const key = `${point.lat.toFixed(6)}:${point.lon.toFixed(6)}:${point.line}`;
      merged.set(key, point);
    });
  });
  return Array.from(merged.values());
}

function createStopIndex(stopPoints, cellSize) {
  const index = new Map();
  stopPoints.forEach(point => {
    const key = getCellKey(point.lat, point.lon, cellSize);
    let list = index.get(key);
    if (!list) {
      list = [];
      index.set(key, list);
    }
    list.push(point);
  });
  return {index, cellSize};
}

function pickLinesForStation(stopIndex, node, maxDistanceMeters) {
  if (!stopIndex || !stopIndex.index) return [];
  const lat = Number(node.lat);
  const lon = Number(node.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const lines = new Set();
  const {index, cellSize} = stopIndex;
  const base = getCellCoords(lat, lon, cellSize);

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${base.x + dx}:${base.y + dy}`;
      const list = index.get(key);
      if (!list) continue;
      list.forEach(point => {
        const distance = distanceMeters(lat, lon, point.lat, point.lon);
        if (distance <= maxDistanceMeters) {
          lines.add(point.line);
        }
      });
    }
  }

  return Array.from(lines.values());
}

function getCellKey(lat, lon, cellSize) {
  const coords = getCellCoords(lat, lon, cellSize);
  return `${coords.x}:${coords.y}`;
}

function getCellCoords(lat, lon, cellSize) {
  return {
    x: Math.floor(lat / cellSize),
    y: Math.floor(lon / cellSize)
  };
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const r = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function normalizeColor(color) {
  if (!color) return null;
  let c = String(color).trim();
  if (!c) return null;
  if (!c.startsWith('#') && /^[0-9A-Fa-f]{6}$/.test(c)) {
    c = `#${c}`;
  }
  return c;
}

function pickRouteColor(tags, fallback) {
  if (!tags) return fallback;
  return normalizeColor(tags.colour || tags.color || tags['colour:de'] || tags['colour:en']) || fallback;
}

function pickLineColor(infoId, ref, fallback) {
  if (!ref) return fallback;
  const key = String(ref).toUpperCase().trim();
  if (infoId === 'sbahn') {
    const sbahnColors = {
      S1: '#E3000F',
      S2: '#008E46',
      S25: '#008E46',
      S26: '#008E46',
      S3: '#0067B8',
      S41: '#A0006B',
      S42: '#A0006B',
      S45: '#A0006B',
      S46: '#A0006B',
      S47: '#A0006B',
      S5: '#FF7F00',
      S7: '#7A1FA2',
      S75: '#7A1FA2',
      S8: '#80C241',
      S85: '#80C241',
      S9: '#9B1B30'
    };
    return sbahnColors[key] || fallback;
  }
  return fallback;
}

function downsample(points) {
  const len = points.length;
  if (len <= 200) return points;

  let step = 1;
  if (len > 8000) step = 28;
  else if (len > 4000) step = 18;
  else if (len > 2000) step = 12;
  else if (len > 1000) step = 8;
  else if (len > 600) step = 4;
  else if (len > 300) step = 2;

  const simplified = [];
  for (let i = 0; i < len; i += step) {
    simplified.push(points[i]);
  }
  if (simplified[simplified.length - 1] !== points[len - 1]) {
    simplified.push(points[len - 1]);
  }
  return simplified;
}

function postOverpass(query) {
  let idx = 0;
  return tryNext();

  function tryNext() {
    if (idx >= backends.length) {
      return Promise.reject(new Error('All Overpass backends failed'));
    }
    const url = backends[idx++];
    return post(url, query).catch(() => tryNext());
  }
}

function post(url, query) {
  const body = 'data=' + encodeURIComponent(query);
  const options = new URL(url);
  options.method = 'POST';
  options.headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Content-Length': Buffer.byteLength(body)
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Overpass ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
