import postData from './postData.js';
import Progress from './Progress.js';
import request from './request.js';
import {LineStripCollection, WireCollection} from 'w-gl';
import tinycolor from 'tinycolor2';

/**
 * Berlin rail network layer definitions with official BVG colors.
 * Each entry uses a direct Overpass QL query with Berlin's bounding box.
 */
const BERLIN_BBOX = '52.338,13.088,52.675,13.761';
const RAIL_CACHE_FILE = 'rail_cache_v1.json';
const USE_THICK_RAIL_LINES = false;

const railCache = new Map();

const RAIL_TYPES = [
  {
    id: 'sbahn',
    name: 'S-Bahn',
    color: '#006F35',   // BVG S-Bahn Grün
    lineWidth: 2,
    route: 'light_rail',
    railway: 'light_rail'
  },
  {
    id: 'ubahn',
    name: 'U-Bahn',
    color: '#115D91',   // BVG U-Bahn Blau
    lineWidth: 2,
    route: 'subway',
    railway: 'subway'
  },
  
];

function buildQuery(railwayType) {
  return `[out:json][timeout:120][bbox:${BERLIN_BBOX}];(way[railway="${railwayType}"];);(._;>;);out body;`;
}

function buildRouteQuery(routeType) {
  return `[out:json][timeout:120][bbox:${BERLIN_BBOX}];(relation[route="${routeType}"];);out body;>;out body;`;
}

function normalizeColor(color) {
  if (!color) return null;
  let c = color.trim();
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
  const key = ref.toUpperCase().trim();
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

/**
 * Loads all Berlin rail layers into the given scene.
 * @param {Object} scene - The w-gl scene API created by createScene
 * @param {GridLayer} baseLayer - The base roads layer (used for projector)
 * @param {Function} onProgress - optional callback(layerName)
 * @returns {Promise<GridLayer[]>} - array of added rail layers
 */
export default async function loadBerlinRail(scene, baseLayer, onProgress) {
  const addedLayers = [];
  const railGroups = {
    sbahn: [],
    ubahn: [],
    tram: [],
    regionalbahn: []
  };
  const stationLayers = [];
  const stationPoints = [];
  const borderLayers = [];
  const stationLineMap = new Map();
  const stopPoints = [];
  let projectPoint;
  if (baseLayer && baseLayer.grid) {
    projectPoint = baseLayer.grid.getProjector();
  }

  const cachedRail = await loadRailCache();
  if (cachedRail && projectPoint) {
    if (onProgress) onProgress('Rail cache', 'cached');
    await renderCachedRail(cachedRail, scene, projectPoint, addedLayers, railGroups, stationLayers, stationPoints, borderLayers, onProgress);
    return {addedLayers, railGroups, stationLayers, stationPoints, borderLayers};
  }

  const tasks = RAIL_TYPES.map(info => async () => {
    if (onProgress) onProgress(info.name, 'loading');
    try {
      if (info.route) {
        await loadRouteLines(info, baseLayer, scene, addedLayers, railGroups, stationLineMap, stopPoints, onProgress);
      } else {
        await loadRailWays(info, baseLayer, scene, addedLayers, railGroups, onProgress);
      }
    } catch (e) {
      console.error(`Failed to load ${info.name}:`, e);
      if (onProgress) onProgress(info.name, 'error');
    }
  });

  await runWithConcurrency(tasks, 2, 1500);

  await loadStations(scene, baseLayer, stationLayers, stationPoints, stationLineMap, stopPoints, onProgress);
  if (baseLayer && baseLayer.grid && baseLayer.grid.projector) {
    await loadBerlinBorder(scene, baseLayer.grid.projector, borderLayers, onProgress);
  }

  return {addedLayers, railGroups, stationLayers, stationPoints, borderLayers};
}

async function loadRailCache() {
  try {
    const cached = await request(`/berlin/rail/${RAIL_CACHE_FILE}`, {responseType: 'json'});
    if (cached && cached.version === 1 && cached.rail) return cached;
  } catch (e) {
    // Cache not available; fall back to raw data.
  }
}

async function renderCachedRail(cache, scene, projectPoint, addedLayers, railGroups, stationLayers, stationPoints, borderLayers, onProgress) {
  const renderer = scene && scene.getRenderer && scene.getRenderer();
  if (!renderer) return;

  const rail = cache.rail || {};
  const railOrder = ['sbahn', 'ubahn'];
  for (const key of railOrder) {
    const info = RAIL_TYPES.find(entry => entry.id === key);
    const entry = rail[key];
    if (!entry) continue;
    const lineWidth = entry.lineWidth || (info && info.lineWidth) || 2;
    const segmentsByColor = entry.segmentsByColor;
    if (segmentsByColor) {
      const colors = Object.keys(segmentsByColor);
      for (let i = 0; i < colors.length; i++) {
        const color = colors[i];
        const segments = segmentsByColor[color];
        if (!segments || !segments.length) continue;
        const wire = await buildWireCollection(scene, projectPoint, segments, color, lineWidth);
        if (!wire) continue;
        wire.id = `${key}-${i}`;
        addedLayers.push(wire);
        if (railGroups[key]) railGroups[key].push(wire);
      }
      if (onProgress) onProgress(info ? info.name : key, 'loaded');
    } else if (entry.segments && entry.segments.length) {
      const color = entry.color || (info && info.color) || '#333333';
      const wire = await buildWireCollection(scene, projectPoint, entry.segments, color, lineWidth);
      if (!wire) continue;
      wire.id = key;
      addedLayers.push(wire);
      if (railGroups[key]) railGroups[key].push(wire);
      if (onProgress) onProgress(info ? info.name : key, 'loaded');
    }
  }

  if (cache.stations) {
    const baseSize = getBaseSize(scene, projectPoint);
    const majorSize = baseSize / 220;
    const minorSize = baseSize / 520;
    const stations = Array.isArray(cache.stations.all) ? cache.stations.all : cache.stations.major || [];

    const major = [];
    const minor = [];
    stations.forEach(station => {
      const isMajor = station.isMajor === true;
      const entry = {
        lon: station.lon,
        lat: station.lat,
        color: station.color || '#FFFFFF',
        name: station.name || 'Unbenannt',
        isMajor,
        lines: Array.isArray(station.lines) ? station.lines : []
      };
      if (isMajor) major.push(entry);
      else minor.push(entry);
      const pos = projectPoint({lon: entry.lon, lat: entry.lat});
      stationPoints.push({
        x: pos.x,
        y: pos.y,
        name: entry.name,
        color: entry.color,
        isMajor,
        lines: entry.lines
      });
    });

    const majorGroups = groupStationsByColor(major);
    for (const [color, list] of majorGroups.entries()) {
      const wire = await buildStationCollection(scene, projectPoint, list, color, majorSize);
      if (wire) stationLayers.push(wire);
    }

    const minorGroups = groupStationsByColor(minor);
    for (const [color, list] of minorGroups.entries()) {
      const wire = await buildStationCollection(scene, projectPoint, list, color, minorSize);
      if (wire) stationLayers.push(wire);
    }

    if (onProgress) onProgress('Stations', 'loaded');
  }

  if (cache.border && Array.isArray(cache.border.segments) && cache.border.segments.length) {
    const wire = await buildWireCollection(scene, projectPoint, cache.border.segments, '#111111', 1.5);
    if (wire) borderLayers.push(wire);
    if (onProgress) onProgress('Berlin Border', 'loaded');
  }
}

function getBaseSize(scene, projectPoint) {
  if (!scene || !scene.getRenderer) return 10000;
  const renderer = scene.getRenderer();
  if (renderer && renderer.getViewBox) {
    const viewBox = renderer.getViewBox();
    if (viewBox) return Math.max(viewBox.right - viewBox.left, viewBox.top - viewBox.bottom);
  }
  return 10000;
}

function groupStationsByColor(stations) {
  const grouped = new Map();
  stations.forEach(station => {
    const color = station.color || '#FFFFFF';
    let list = grouped.get(color);
    if (!list) {
      list = [];
      grouped.set(color, list);
    }
    list.push(station);
  });
  return grouped;
}

async function buildWireCollection(scene, projectPoint, segments, color, lineWidth) {
  if (!scene || !segments || !segments.length) return;
  const renderer = scene.getRenderer();
  if (!renderer || !renderer.appendChild) return;

  const resolvedWidth = USE_THICK_RAIL_LINES ? lineWidth : 1;
  const wire = new WireCollection(segments.length, {width: resolvedWidth, allowColors: false, is3D: false});
  const tc = tinycolor(color).toRgb();
  wire.color = {r: tc.r/0xff, g: tc.g/0xff, b: tc.b/0xff, a: 1};

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const from = projectPoint({lon: s[0], lat: s[1]});
    const to = projectPoint({lon: s[2], lat: s[3]});
    wire.add({from, to});
    if (i > 0 && i % 40000 === 0) await yieldToBrowser();
  }

  renderer.appendChild(wire);
  return wire;
}

async function buildStationCollection(scene, projectPoint, stations, color, size) {
  if (!scene || !stations || !stations.length) return;
  const renderer = scene.getRenderer();
  if (!renderer || !renderer.appendChild) return;

  const segmentsCount = stations.length * 8;
  const wire = new WireCollection(segmentsCount, {width: 1, allowColors: false, is3D: false});
  const tc = tinycolor(color).toRgb();
  wire.color = {r: tc.r/0xff, g: tc.g/0xff, b: tc.b/0xff, a: 1};
  const outerHalf = size / 2;
  const innerHalf = outerHalf * 0.65;

  for (let i = 0; i < stations.length; i++) {
    const station = stations[i];
    const pos = projectPoint({lon: station.lon, lat: station.lat});
    addSquare(wire, pos.x, pos.y, outerHalf);
    addSquare(wire, pos.x, pos.y, innerHalf);

    if (i > 0 && i % 20000 === 0) await yieldToBrowser();
  }

  renderer.appendChild(wire);
  return wire;
}

function addSquare(wire, cx, cy, half) {
  const left = cx - half;
  const right = cx + half;
  const top = cy - half;
  const bottom = cy + half;

  wire.add({from: {x: left, y: top, z: 0}, to: {x: right, y: top, z: 0}});
  wire.add({from: {x: right, y: top, z: 0}, to: {x: right, y: bottom, z: 0}});
  wire.add({from: {x: right, y: bottom, z: 0}, to: {x: left, y: bottom, z: 0}});
  wire.add({from: {x: left, y: bottom, z: 0}, to: {x: left, y: top, z: 0}});
}

function createStopIndex(stopPoints, cellSize) {
  const index = new Map();
  if (!stopPoints || !stopPoints.length) return {index, cellSize};
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

function mergeLines(primary, secondary) {
  const merged = new Set();
  if (Array.isArray(primary)) primary.forEach(line => merged.add(line));
  if (Array.isArray(secondary)) secondary.forEach(line => merged.add(line));
  return Array.from(merged.values());
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

async function runWithConcurrency(tasks, concurrency, staggerMs) {
  let index = 0;
  const workers = new Array(concurrency).fill(null).map(async () => {
    while (index < tasks.length) {
      const current = index++;
      if (staggerMs) await delay(staggerMs);
      await tasks[current]();
    }
  });
  await Promise.all(workers);
}

async function loadRouteLines(info, baseLayer, scene, addedLayers, railGroups, stationLineMap, stopPoints, onProgress) {
  let osmResponse = railCache.get(info.route);
  if (!osmResponse) {
    const query = buildRouteQuery(info.route);
    osmResponse = await loadStaticOrOverpass(`route_${info.route}.json`, query, info.route);
  } else if (onProgress) {
    onProgress(info.name, 'cached');
  }

  if (!osmResponse || !osmResponse.elements || osmResponse.elements.length === 0) {
    console.warn(`No data returned for ${info.name}`);
    if (onProgress) onProgress(info.name, 'no data');
    return;
  }

  osmResponse.elements.forEach(el => {
    if (el.type === 'node') {
      el.lat = Number(el.lat);
      el.lon = Number(el.lon);
    }
  });

  const relations = osmResponse.elements.filter(el => el.type === 'relation' && el.tags && el.tags.route === info.route);
  const ways = osmResponse.elements.filter(el => el.type === 'way');
  const nodes = osmResponse.elements.filter(el => el.type === 'node');

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const wayMap = new Map(ways.map(w => [w.id, w]));

  if (onProgress) {
    onProgress(info.name, 'stats', {elements: osmResponse.elements.length, ways: ways.length, nodes: nodes.length, lines: relations.length});
  }

  let rendered = 0;
  const projectPoint = baseLayer && baseLayer.grid ? baseLayer.grid.getProjector() : null;
  const segmentsByColor = new Map();
  for (const rel of relations) {
    const wayIds = new Set((rel.members || []).filter(m => m.type === 'way').map(m => m.ref));
    if (wayIds.size === 0) continue;

    const ref = (rel.tags && (rel.tags.ref || rel.tags.name)) || info.name;
    const color = pickLineColor(info.id, ref, pickRouteColor(rel.tags, info.color));
    let segments = segmentsByColor.get(color);
    if (!segments) {
      segments = [];
      segmentsByColor.set(color, segments);
    }

    if (rel.members && rel.members.length) {
      const cleanRef = String(ref).trim();
      rel.members.forEach(member => {
        if (!member || member.type !== 'node') return;
        const node = nodeMap.get(member.ref);
        if (node && cleanRef) {
          stopPoints.push({lon: node.lon, lat: node.lat, line: cleanRef});
        }
        let set = stationLineMap.get(member.ref);
        if (!set) {
          set = new Set();
          stationLineMap.set(member.ref, set);
        }
        if (cleanRef) set.add(cleanRef);
      });
    }

    for (const wayId of wayIds) {
      const way = wayMap.get(wayId);
      if (!way || !way.nodes) continue;
      const points = way.nodes.map(id => nodeMap.get(id)).filter(Boolean).map(n => ({lon: n.lon, lat: n.lat}));
      const simplified = downsampleGeoPoints(points);
      for (let i = 1; i < simplified.length; i++) {
        const a = simplified[i - 1];
        const b = simplified[i];
        segments.push([a.lon, a.lat, b.lon, b.lat]);
      }
      rendered += 1;
      if (rendered % 500 === 0) await yieldToBrowser();
    }
  }

  if (projectPoint && segmentsByColor.size) {
    let index = 0;
    for (const [color, segments] of segmentsByColor.entries()) {
      if (!segments.length) continue;
      const wire = await buildWireCollection(scene, projectPoint, segments, color, info.lineWidth || 2);
      if (wire) {
        wire.id = `${info.id}-${index}`;
        addedLayers.push(wire);
        if (railGroups && railGroups[info.id]) {
          railGroups[info.id].push(wire);
        }
      }
      index += 1;
    }
  }

  if (onProgress) onProgress(info.name, 'loaded');
}

async function loadRailWays(info, baseLayer, scene, addedLayers, railGroups, onProgress) {
  let osmResponse = railCache.get(info.railway);
  if (!osmResponse) {
    const query = buildQuery(info.railway);
    osmResponse = await loadStaticOrOverpass(`rail_${info.railway}.json`, query, info.railway);
  } else if (onProgress) {
    onProgress(info.name, 'cached');
  }

  if (!osmResponse || !osmResponse.elements || osmResponse.elements.length === 0) {
    console.warn(`No data returned for ${info.name}`);
    if (onProgress) onProgress(info.name, 'no data');
    return;
  }

  osmResponse.elements.forEach(el => {
    if (el.type === 'node') {
      el.lat = Number(el.lat);
      el.lon = Number(el.lon);
    }
  });

  const ways = osmResponse.elements.filter(el => el.type === 'way');
  const nodes = osmResponse.elements.filter(el => el.type === 'node');
  if (ways.length === 0) {
    console.warn(`No ways found for ${info.name}`);
    if (onProgress) onProgress(info.name, 'no ways');
    return;
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const projectPoint = baseLayer && baseLayer.grid ? baseLayer.grid.getProjector() : null;
  const segments = [];
  let rendered = 0;
  for (const way of ways) {
    const points = (way.nodes || []).map(id => nodeMap.get(id)).filter(Boolean).map(n => ({lon: n.lon, lat: n.lat}));
    const simplified = downsampleGeoPoints(points);
    for (let i = 1; i < simplified.length; i++) {
      const a = simplified[i - 1];
      const b = simplified[i];
      segments.push([a.lon, a.lat, b.lon, b.lat]);
    }
    rendered += 1;
    if (rendered % 500 === 0) await yieldToBrowser();
  }

  if (segments.length && projectPoint) {
    const wire = await buildWireCollection(scene, projectPoint, segments, info.color, info.lineWidth || 2);
    if (wire) {
      wire.id = info.id;
      addedLayers.push(wire);
      if (railGroups && railGroups[info.id]) {
        railGroups[info.id].push(wire);
      }
    }
  }

  if (onProgress) onProgress(info.name, 'loaded');
}

async function loadStations(scene, baseLayer, stationLayers, stationPoints, stationLineMap, stopPoints, onProgress) {
  if (!scene || !baseLayer) return;

  const query = `[out:json][timeout:120][bbox:${BERLIN_BBOX}];(
    node[railway="station"];
    node[public_transport="station"];
    node[station];
  );out body;`;

  let response = railCache.get('stations');
  if (!response) {
    response = await loadStaticOrOverpass('stations.json', query, 'stations');
  }

  if (!response || !response.elements || response.elements.length === 0) return;

  const nodes = response.elements.filter(el => el.type === 'node');
  if (nodes.length === 0) return;

  const renderer = scene.getRenderer();
  if (!renderer || !renderer.appendChild) return;

  const viewBox = baseLayer.getViewBox();
  const baseSize = viewBox ? Math.max(viewBox.right - viewBox.left, viewBox.top - viewBox.bottom) : 10000;
  const majorSize = baseSize / 220;
  const minorSize = baseSize / 520;
  const projectPoint = baseLayer.grid.getProjector();

  const major = [];
  const minor = [];
  const stopIndex = createStopIndex(stopPoints, 0.002);
  nodes.forEach(node => {
    const tags = node.tags || {};
    const isMajor = tags.station === 'major' || tags.station === 'interchange' || tags.railway === 'station';

    let color = '#FFFFFF';
    if (tags.station === 'subway' || tags.subway === 'yes') color = '#115D91';
    else if (tags.network && tags.network.includes('S-Bahn')) color = '#006F35';
    else if (tags.railway === 'station') color = '#EC6608';

    const name = tags.name || tags['name:de'] || tags['name:en'] || tags.ref || 'Unbenannt';
    const lineSet = stationLineMap && stationLineMap.get(node.id);
    const directLines = lineSet ? Array.from(lineSet) : [];
    const nearbyLines = pickLinesForStation(stopIndex, node, 150);
    const lines = mergeLines(directLines, nearbyLines);
    const entry = {lon: Number(node.lon), lat: Number(node.lat), name, color, isMajor, lines};
    if (isMajor) major.push(entry);
    else minor.push(entry);
    const pos = projectPoint({lon: entry.lon, lat: entry.lat});
    stationPoints.push({
      x: pos.x,
      y: pos.y,
      name: entry.name,
      color: entry.color,
      isMajor,
      lines: entry.lines
    });
  });

  const majorGroups = groupStationsByColor(major);
  for (const [color, list] of majorGroups.entries()) {
    const wire = await buildStationCollection(scene, projectPoint, list, color, majorSize);
    if (wire) stationLayers.push(wire);
  }

  const minorGroups = groupStationsByColor(minor);
  for (const [color, list] of minorGroups.entries()) {
    const wire = await buildStationCollection(scene, projectPoint, list, color, minorSize);
    if (wire) stationLayers.push(wire);
  }

  if (onProgress) onProgress('Stations', 'loaded');
}

async function loadBerlinBorder(scene, sharedProjector, borderLayers, onProgress) {
  if (!scene || !sharedProjector) return;

  const query = `[out:json][timeout:120];relation[boundary="administrative"][admin_level="4"][name="Berlin"];out body;>;out body;`;
  let response = railCache.get('berlin-border');
  if (!response) {
    response = await loadStaticOrOverpass('border.json', query, 'berlin-border');
  }

  if (!response || !response.elements || response.elements.length === 0) return;

  const relations = response.elements.filter(el => el.type === 'relation');
  const ways = response.elements.filter(el => el.type === 'way');
  const nodes = response.elements.filter(el => el.type === 'node');
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const wayMap = new Map(ways.map(w => [w.id, w]));
  const projector = createProjector(sharedProjector);

  for (const rel of relations) {
    const members = rel.members || [];
    let wayMembers = members.filter(m => m.type === 'way' && m.role === 'outer');
    if (!wayMembers.length) {
      wayMembers = members.filter(m => m.type === 'way');
    }
    const wayIds = new Set(wayMembers.map(m => m.ref));
    if (wayIds.size === 0) continue;
    for (const wayId of wayIds) {
      const way = wayMap.get(wayId);
      if (!way || !way.nodes) continue;
      const points = way.nodes.map(id => nodeMap.get(id)).filter(Boolean).map(n => projector({lon: n.lon, lat: n.lat}));
      if (points.length < 2) continue;
      const strip = appendLineStrip(scene, points, '#111111', true);
      if (strip) borderLayers.push(strip);
    }
  }

  if (onProgress) onProgress('Berlin Border', 'loaded');
}

function createProjector(projector) {
  return function project({lon, lat}) {
    const xyPoint = projector([lon, lat]);
    return {x: xyPoint[0], y: -xyPoint[1]};
  }
}

function appendLineStrip(scene, points, color, closed = false) {
  if (!scene || !points || points.length < 2) return;
  const renderer = scene.getRenderer();
  if (!renderer || !renderer.appendChild) return;

  const simplified = downsamplePoints(points);
  if (!simplified || simplified.length < 2) return;

  const strip = new LineStripCollection(simplified.length + (closed ? 1 : 0), {allowColors: false, is3D: false});
  simplified.forEach(p => strip.add({x: p.x, y: p.y, z: 0}));
  if (closed) {
    const first = simplified[0];
    strip.add({x: first.x, y: first.y, z: 0});
  }

  const tc = tinycolor(color).toRgb();
  strip.color = {r: tc.r/0xff, g: tc.g/0xff, b: tc.b/0xff, a: 1};
  renderer.appendChild(strip);
  return strip;
}

function downsamplePoints(points) {
  const len = points.length;
  if (len <= 200) return points;

  let step = 1;
  if (len > 5000) step = 20;
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

function downsampleGeoPoints(points) {
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

function buildSquarePoints(x, y, size) {
  const half = size / 2;
  return [
    {x: x - half, y: y - half},
    {x: x + half, y: y - half},
    {x: x + half, y: y + half},
    {x: x - half, y: y + half}
  ];
}

function buildRoundedRectPoints(x, y, w, h, r) {
  const halfW = w / 2;
  const halfH = h / 2;
  const left = x - halfW;
  const right = x + halfW;
  const top = y - halfH;
  const bottom = y + halfH;

  const seg = 6;
  const step = (Math.PI / 2) / seg;

  const points = [];
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI + i * step;
    points.push({x: left + r + Math.cos(a) * r, y: top + r + Math.sin(a) * r});
  }
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + i * step;
    points.push({x: right - r + Math.cos(a) * r, y: top + r + Math.sin(a) * r});
  }
  for (let i = 0; i <= seg; i++) {
    const a = 0 + i * step;
    points.push({x: right - r + Math.cos(a) * r, y: bottom - r + Math.sin(a) * r});
  }
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI / 2 + i * step;
    points.push({x: left + r + Math.cos(a) * r, y: bottom - r + Math.sin(a) * r});
  }

  return points;
}

async function loadStaticOrOverpass(fileName, query, cacheKey) {
  const cacheHit = railCache.get(cacheKey);
  if (cacheHit) return cacheHit;

  try {
    const staticResponse = await request(`/berlin/rail/${fileName}`, {responseType: 'json'});
    if (staticResponse && staticResponse.elements) {
      railCache.set(cacheKey, staticResponse);
      return staticResponse;
    }
  } catch (e) {
    // Static cache not found or not accessible; fallback to Overpass.
  }

  const progress = new Progress();
  const osmResponse = await postData(query, progress);
  railCache.set(cacheKey, osmResponse);
  return osmResponse;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function yieldToBrowser() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}
