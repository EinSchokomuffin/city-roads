<template>
  <find-place v-if='!placeFound' @loaded='onGridLoaded'></find-place>
  <div id="app">
    <div v-if='placeFound'>
      <div class='controls'>
        <a href="#" class='print-button' data-action='toggle-settings' @click.prevent='toggleSettings'>Customize...</a>
        <a v-if='!lockedToDefaultCity' href="#" class='try-another' @click.prevent='startOver'>Try another city</a>
      </div>
      <div class='rail-status' v-if='railLoading || railStatus.length || railErrors.length'>
        <div class='rail-title'>Bahnnetze Berlin</div>
        <div v-if='railLoading' class='rail-loading'>Lade Bahnnetze…</div>
        <div class='rail-toggles'>
          <label><input type='checkbox' v-model='railVisibility.ubahn' @change='applyRailVisibility'> U-Bahn</label>
          <label><input type='checkbox' v-model='railVisibility.sbahn' @change='applyRailVisibility'> S-Bahn</label>
          <label><input type='checkbox' v-model='railVisibility.stations' @change='applyRailVisibility'> Stationen</label>
          <label><input type='checkbox' v-model='railVisibility.border' @change='applyRailVisibility'> Berlin-Grenze</label>
        </div>
        <ul v-if='railStatus.length'>
          <li v-for='entry in railStatus' :key='entry.name'>
            {{entry.name}} — {{entry.status}}
            <span v-if='railStats[entry.name]'>
              (ways: {{railStats[entry.name].ways}}, nodes: {{railStats[entry.name].nodes}})
            </span>
          </li>
        </ul>
        <div v-if='railErrors.length' class='rail-errors'>
          <div v-for='(err, idx) in railErrors' :key='idx'>{{err}}</div>
        </div>
      </div>
      <div v-if='showSettings' class='print-window'>
        <h3>Export</h3>
        <div class='row'>
          <a href='#' @click.prevent='zazzleMugPrint()' class='col'>Onto a mug</a> 
          <span class='col c-2'>
            Print what you see onto a mug. <br/>Get a unique gift of your favorite city.
          </span>
        </div>
        <div class='preview-actions message' v-if='zazzleLink || generatingPreview'>
            <div v-if='zazzleLink' class='padded popup-help'>
              If your browser has blocked the new window, <br/>please <a :href='zazzleLink' target='_blank'>click here</a>
              to open it.
            </div>
            <div v-if='generatingPreview' class='loading-container'>
              <loading-icon></loading-icon>
              Generating preview url...
            </div>
        </div>
        <div class='row'>
          <a href='#'  @click.prevent='toPNGFile' class='col'>As an image (.png)</a> 
          <span class='col c-2'>
            Save the current screen as a raster image.
          </span>
        </div>
        <div class='row'>
          <a href='#' data-export='full-map-png' @click.prevent='toPNGFullMap' class='col'>Full map PNG (huge)</a> 
          <span class='col c-2'>
            Export the whole map at very high resolution.
          </span>
        </div>
        <div class='export-progress' v-if='exportingPng'>
          <div class='export-label'>Exportiere PNG… {{exportProgress}}%</div>
          <div class='export-bar'>
            <div class='export-bar-fill' :style='{width: exportProgress + "%"}'></div>
          </div>
        </div>
        
        <div class='row'>
          <a href='#'  @click.prevent='toSVGFile' class='col'>As a vector (.svg)</a> 
          <span class='col c-2'>
            Save the current screen as a vector image.
          </span>
        </div>
        <div v-if='false' class='row'>
          <a href='#' @click.prevent='toProtobuf' class='col'>To a .PBF file</a> 
          <span class='col c-2'>
            Save the current data as a protobuf message. For developer use only.
          </span>
        </div>

        <h3>About</h3>
        <div>
          <p>This website was created by <a href='https://twitter.com/anvaka' target='_blank'>@anvaka</a>.
          It downloads roads from OpenStreetMap and renders them with WebGL.
          </p>
          <p>
           You can find the entire <a href='https://github.com/anvaka/city-roads'>source code here</a>. 
           If you love this website you can also <a href='https://www.paypal.com/paypalme2/anvakos/3'>buy me a coffee</a> or 
           <a href='https://www.patreon.com/anvaka'>support me on Patreon</a>, but you don't have to.
          </p>
        </div>
      </div>
    </div>
  </div>

  <editable-label v-if='placeFound' v-model='name' class='city-name' :printable='true' :style='{color: labelColorRGBA}' :overlay-manager='overlayManager'></editable-label>
  <div v-if='placeFound' class='license printable can-drag' :style='{color: labelColorRGBA}'>data <a href='https://www.openstreetmap.org/about/' target="_blank" :style='{color: labelColorRGBA}'>© OpenStreetMap</a></div>

  <div v-if='stationTooltip.visible' class='station-tooltip' :style='{left: stationTooltip.left + "px", top: stationTooltip.top + "px"}'>
    <div class='station-tooltip-name'>{{stationTooltip.name}}</div>
    <div v-if='stationLineDisplay' class='station-tooltip-lines'>{{stationLineDisplay}}</div>
  </div>

  <div v-if='exportMode && (exportingPng || exportResultUrl)' class='export-overlay'>
    <div class='export-overlay-card'>
      <div v-if='exportingPng'>
        <div class='export-label'>Exportiere Full-Map PNG… {{exportProgress}}%</div>
        <div class='export-bar'>
          <div class='export-bar-fill' :style='{width: exportProgress + "%"}'></div>
        </div>
      </div>
      <div v-else class='export-result'>
        <div class='export-label'>Export fertig</div>
        <img :src='exportResultUrl' alt='Full-map export preview' />
        <div class='export-actions'>
          <a :href='exportResultUrl' :download='exportResultName'>PNG herunterladen</a>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import FindPlace from './components/FindPlace.vue';
import LoadingIcon from './components/LoadingIcon.vue';
import EditableLabel from './components/EditableLabel.vue';
import createScene from './lib/createScene.js';
import GridLayer from './lib/GridLayer.js';
import loadBerlinRail from './lib/loadBerlinRail.js';
import generateZazzleLink from './lib/getZazzleLink.js';
import appState from './lib/appState.js';
import {getPrintableCanvas, getCanvas} from './lib/saveFile.js';
import config from './config.js';
import './lib/canvas2BlobPolyfill.js';
import bus from './lib/bus.js';
import createOverlayManager from './createOverlayManager.js';
import tinycolor from 'tinycolor2';

class ColorLayer {
  constructor(name, color, callback) {
    this.name = name;
    this.changeColor = callback;
    this.color = color;
  }
}

export default {
  name: 'App',
  components: {
    FindPlace,
    LoadingIcon,
    EditableLabel
  },
  data() {
    return {
      placeFound: false,
      name: '',
      zazzleLink: null,
      generatingPreview: false,
      showSettings: false,
      settingsOpen: false,
      labelColor: config.getLabelColor().toRgb(),
      backgroundColor: config.getBackgroundColor().toRgb(),
      layers: [],
      lockedToDefaultCity: config.lockToDefaultCity === true,
      railLoading: false,
      railStatus: [],
      railErrors: [],
      railStats: {},
      railVisibility: {
        sbahn: true,
        ubahn: true,
        stations: true,
        border: true
      },
      railLayersByType: {
        sbahn: [],
        ubahn: []
      },
      stationLayers: [],
      stationPoints: [],
      selectedStation: null,
      stationTooltip: {
        visible: false,
        name: '',
        lines: [],
        left: 0,
        top: 0
      },
      stationHitRadiusPx: 12,
      borderLayers: [],
      cameraZoom: 1,
      stationZoomThreshold: 2,
      exportingPng: false,
      exportProgress: 0,
      baseViewBox: null,
      exportMode: getQueryParam('export') === 'full',
      exportAutoTriggered: false,
      exportResultUrl: null,
      exportResultName: ''
    }
  },
  computed: {
    labelColorRGBA() {
      return toRGBA(this.labelColor);
    },
    stationLineDisplay() {
      return this.formatStationLines(this.stationTooltip.lines);
    }
  },
  created() {
    bus.on('scene-transform', this.handleSceneTransform);
    bus.on('background-color', this.syncBackground);
    bus.on('line-color', this.syncLineColor);
    this.overlayManager = createOverlayManager();
  },
  beforeUnmount() {
    debugger;
    this.overlayManager.dispose();
    this.dispose();
    this.unbindStationClickHandler();
    bus.off('scene-transform', this.handleSceneTransform);
    bus.off('background-color', this.syncBackground);
    bus.off('line-color', this.syncLineColor);
  },
  methods: {
    clearExportResult() {
      if (this.exportResultUrl) {
        window.URL.revokeObjectURL(this.exportResultUrl);
      }
      this.exportResultUrl = null;
      this.exportResultName = '';
    },
    dispose() {
      if (this.scene) {
        this.scene.dispose();
        window.scene = null;
      }
    },
    toggleSettings() {
      this.showSettings = !this.showSettings;
    },
    handleSceneTransform() {
      this.zazzleLink = null;
      this.applyStationVisibility();
      this.updateStationTooltipPosition();
    },
    onGridLoaded(grid) {
      if (grid.isArea) {
        appState.set('areaId', grid.id);
        appState.unset('osm_id');
        appState.unset('bbox');
      } else if (grid.bboxString) {
        appState.unset('areaId');
        appState.set('osm_id', grid.id);
        appState.set('bbox', grid.bboxString);
      }
      this.placeFound = true;
      this.name = grid.name.split(',')[0];
      let canvas = getCanvas();
      canvas.style.visibility = 'visible';

      this.scene = createScene(canvas);
      this.scene.on('layer-added', this.updateLayers);
      this.scene.on('layer-removed', this.updateLayers);

      this.initZoomTracking();

      window.scene = this.scene;

      let gridLayer = new GridLayer();
      gridLayer.id = 'lines';
      gridLayer.setGrid(grid);
      this.scene.add(gridLayer)
      gridLayer.color = 'rgba(0, 0, 0, 0.15)';
      this.baseViewBox = gridLayer.getViewBox();

      this.loadRailLayers(gridLayer);
    },

    startOver() {
      appState.unset('areaId');
      appState.unsetPlace();
      appState.unset('q');
      appState.enableCache();

      this.dispose();
      this.placeFound = false;
      this.zazzleLink = null;
      this.showSettings = false;
      this.backgroundColor = config.getBackgroundColor().toRgb();
      this.labelColor = config.getLabelColor().toRgb();

      document.body.style.backgroundColor = config.getBackgroundColor().toRgbString();
      getCanvas().style.visibility = 'hidden';
    },

    async toPNGFile() {
      if (!this.scene || this.exportingPng) return;
      this.exportingPng = true;
      this.exportProgress = 0;
      try {
        const canvas = getCanvas();
        const maxDim = 20000;
        const base = Math.max(canvas.width, canvas.height);
        const scale = Math.max(1, Math.min(16, Math.floor(maxDim / base)));
        await this.scene.saveToPNG(this.name, {
          scale,
          onProgress: ({percent}) => {
            if (Number.isFinite(percent)) this.exportProgress = Math.max(0, Math.min(100, percent));
          }
        });
      } finally {
        this.exportingPng = false;
        this.exportProgress = 0;
      }
    },

    async toPNGFullMap() {
      if (!this.scene || this.exportingPng) return;
      const renderer = this.scene.getRenderer();
      if (!renderer || !renderer.setViewBox || !this.baseViewBox) {
        return this.toPNGFile();
      }

      if (this.exportMode) {
        this.clearExportResult();
      }

      this.exportingPng = true;
      this.exportProgress = 0;
      try {
        renderer.setViewBox(this.baseViewBox);
        renderer.renderFrame(true);

        const canvas = getCanvas();
        const maxDim = 30000;
        const base = Math.max(canvas.width, canvas.height);
        const scale = Math.max(1, Math.min(32, Math.floor(maxDim / base)));

        await this.scene.saveToPNG(this.name, {
          scale,
          onProgress: ({percent}) => {
            if (Number.isFinite(percent)) this.exportProgress = Math.max(0, Math.min(100, percent));
          },
          skipDownload: this.exportMode,
          onComplete: ({url, fileName}) => {
            if (!this.exportMode) return;
            this.exportResultUrl = url;
            this.exportResultName = fileName;
          }
        });
      } finally {
        this.exportingPng = false;
        this.exportProgress = 0;
      }
    },

    toSVGFile() { 
      if (this.scene) this.scene.saveToSVG(this.name)
    },

    updateLayers() {
      // TODO: This method likely doesn't belong here
      let newLayers = [];
      let lastLayer = 0;
      let renderer = this.scene.getRenderer();
      let root = renderer.getRoot();
      root.children.forEach(layer => {
        if (!layer.color) return;
        let name = layer.id;
        if (!name) {
          lastLayer += 1;
          name = 'lines ' + lastLayer;
        }
        let layerColor = tinycolor.fromRatio(layer.color);
        newLayers.push(new ColorLayer(name, layerColor, newColor => {
          this.zazzleLink = null;
          layer.color = toRatioColor(newColor);
          renderer.renderFrame();
          this.scene.fire('color-change', layer);
        }));
      });

      newLayers.push(
        new ColorLayer('background', this.backgroundColor, this.setBackgroundColor),
        new ColorLayer('labels', this.labelColor, newColor => this.labelColor = newColor)
      );

      this.layers = newLayers;

      function toRatioColor(c) {
        return {r: c.r/0xff, g: c.g/0xff, b: c.b/0xff, a: c.a}
      }
      this.zazzleLink = null;
    },

    syncLineColor() {
      this.updateLayers();
    },

    syncBackground(newBackground) {
      this.backgroundColor = newBackground.toRgb();
      this.updateLayers()
    },
    // TODO: I need two background methods?
    updateBackground() {
      this.setBackgroundColor(this.backgroundColor)
      this.zazzleLink = null;
    },
    setBackgroundColor(c) {
      this.scene.background = c;
      document.body.style.backgroundColor = toRGBA(c);
      this.zazzleLink = null;
    },

    loadRailLayers(baseLayer) {
      if (!this.scene || !baseLayer) return;

      this.railLoading = true;
      this.railStatus = [];
      this.railErrors = [];
      this.railStats = {};

      const setRailStatus = (name, status) => {
        const idx = this.railStatus.findIndex(entry => entry.name === name);
        if (idx === -1) {
          this.railStatus.push({name, status});
        } else {
          this.railStatus[idx].status = status;
        }
      };

      loadBerlinRail(this.scene, baseLayer, (name, status, meta) => {
        if (status === 'stats' && meta) {
          this.railStats[name] = meta;
          return;
        }
        setRailStatus(name, status);
      }).then(result => {
        this.railLoading = false;
        if (result && result.addedLayers && result.addedLayers.length === 0) {
          this.railErrors.push('No rail data returned from Overpass.');
        }
        if (result) {
          this.railLayersByType = result.railGroups || this.railLayersByType;
          this.stationLayers = result.stationLayers || [];
          this.stationPoints = result.stationPoints || [];
          this.borderLayers = result.borderLayers || [];
        }
        this.bindStationClickHandler();
        this.applyRailVisibility();
        this.updateLayers();
        if (this.scene) this.scene.render();
        if (this.exportMode && !this.exportAutoTriggered) {
          this.exportAutoTriggered = true;
          this.toPNGFullMap();
        }
      }).catch(e => {
        this.railLoading = false;
        this.railErrors.push(e && e.message ? e.message : 'Rail loading failed');
        console.error('Rail loading failed:', e);
      });
    },

    applyRailVisibility() {
      if (!this.scene) return;
      const renderer = this.scene.getRenderer();
      if (!renderer) return;

      const toggleGroup = (list, visible) => {
        if (!list || !list.length) return;
        list.forEach(el => {
          if (visible) {
            if (!el.parent) renderer.appendChild(el);
          } else if (el.parent) {
            renderer.removeChild(el);
          }
        });
      };

      toggleGroup(this.railLayersByType.sbahn, this.railVisibility.sbahn);
      toggleGroup(this.railLayersByType.ubahn, this.railVisibility.ubahn);
      this.applyStationVisibility(renderer, toggleGroup);
      toggleGroup(this.borderLayers, this.railVisibility.border);

      if (renderer.renderFrame) renderer.renderFrame(true);
    },

    applyStationVisibility(renderer, toggleGroup) {
      const targetRenderer = renderer || (this.scene && this.scene.getRenderer && this.scene.getRenderer());
      if (!targetRenderer) return;
      const localToggle = toggleGroup || ((list, visible) => {
        if (!list || !list.length) return;
        list.forEach(el => {
          if (visible) {
            if (!el.parent) targetRenderer.appendChild(el);
          } else if (el.parent) {
            targetRenderer.removeChild(el);
          }
        });
      });

      const stationsVisible = this.railVisibility.stations;
      localToggle(this.stationLayers, stationsVisible);
      if (!stationsVisible) this.clearStationTooltip();
    },

    bindStationClickHandler() {
      if (!this.scene || !this.scene.getRenderer) return;
      if (this.stationClickHandler) return;

      const renderer = this.scene.getRenderer();
      if (!renderer || !renderer.on) return;

      this.stationClickHandler = (e) => {
        this.handleStationClick(e, renderer);
      };
      renderer.on('click', this.stationClickHandler);
    },

    unbindStationClickHandler() {
      if (!this.stationClickHandler || !this.scene || !this.scene.getRenderer) return;
      const renderer = this.scene.getRenderer();
      if (renderer && renderer.off) renderer.off('click', this.stationClickHandler);
      this.stationClickHandler = null;
    },

    handleStationClick(e, renderer) {
      if (!this.railVisibility.stations) return;
      if (!this.stationPoints || this.stationPoints.length === 0) return;
      const original = e && e.originalEvent;
      if (!original) return;

      const radiusWorld = this.getWorldRadius(renderer, original.clientX, original.clientY, this.stationHitRadiusPx);
      const pick = this.findClosestStation(e.x, e.y, radiusWorld);
      if (!pick) {
        this.clearStationTooltip();
        return;
      }

      if (this.selectedStation && this.selectedStation === pick) {
        this.clearStationTooltip();
        return;
      }

      this.selectedStation = pick;
      this.stationTooltip.visible = true;
      this.stationTooltip.name = pick.name;
      this.stationTooltip.lines = Array.isArray(pick.lines) ? pick.lines : [];
      this.updateStationTooltipPosition(renderer);
    },

    findClosestStation(x, y, radius) {
      if (!Number.isFinite(radius) || radius <= 0) return null;
      const maxDist2 = radius * radius;
      let best = null;
      let bestDist2 = maxDist2;
      for (let i = 0; i < this.stationPoints.length; i++) {
        const s = this.stationPoints[i];
        const dx = s.x - x;
        const dy = s.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestDist2) {
          best = s;
          bestDist2 = d2;
        }
      }
      return best;
    },

    getWorldRadius(renderer, clientX, clientY, radiusPx) {
      if (!renderer || !renderer.getSceneCoordinate) return radiusPx;
      const center = renderer.getSceneCoordinate(clientX, clientY);
      const edge = renderer.getSceneCoordinate(clientX + radiusPx, clientY);
      if (!center || !edge) return radiusPx;
      return Math.hypot(edge[0] - center[0], edge[1] - center[1]);
    },

    updateStationTooltipPosition(renderer) {
      if (!this.stationTooltip.visible || !this.selectedStation) return;
      const targetRenderer = renderer || (this.scene && this.scene.getRenderer && this.scene.getRenderer());
      if (!targetRenderer || !targetRenderer.getClientCoordinate) return;

      const point = targetRenderer.getClientCoordinate(this.selectedStation.x, this.selectedStation.y, 0);
      if (!point) return;
      const canvas = getCanvas();
      const rect = canvas ? canvas.getBoundingClientRect() : {left: 0, top: 0};
      this.stationTooltip.left = rect.left + point.x;
      this.stationTooltip.top = rect.top + point.y;
    },

    clearStationTooltip() {
      this.stationTooltip.visible = false;
      this.stationTooltip.name = '';
      this.stationTooltip.lines = [];
      this.selectedStation = null;
    },

    formatStationLines(lines) {
      if (!Array.isArray(lines) || !lines.length) return 'Linien: —';
      const unique = Array.from(new Set(lines.map(line => String(line).trim()).filter(Boolean)));
      unique.sort(compareLineRefs);

      const groups = {
        u: [],
        s: [],
        other: []
      };

      unique.forEach(ref => {
        if (/^U\s*\d+/i.test(ref)) groups.u.push(ref.replace(/\s+/g, ''));
        else if (/^S\s*\d+/i.test(ref)) groups.s.push(ref.replace(/\s+/g, ''));
        else groups.other.push(ref);
      });

      const parts = [];
      if (groups.u.length) parts.push(`U-Bahn: ${groups.u.join(', ')}`);
      if (groups.s.length) parts.push(`S-Bahn: ${groups.s.join(', ')}`);
      if (groups.other.length) parts.push(`Linien: ${groups.other.join(', ')}`);

      return parts.join(' · ');
    },

    initZoomTracking() {
      if (!this.scene || !this.scene.getRenderer) return;
      const renderer = this.scene.getRenderer();
      if (!renderer || !renderer.getCameraController) return;
      const camera = renderer.getCameraController();
      if (!camera || camera.__zoomTracked) return;

      camera.__zoomTracked = true;
      let zoom = this.cameraZoom || 1;

      const updateZoom = (scaleFactor) => {
        if (!Number.isFinite(scaleFactor)) return;
        const denom = 1 - scaleFactor;
        if (denom === 0) return;
        zoom = zoom / denom;
        this.cameraZoom = zoom;
        this.applyStationVisibility(renderer);
      };

      if (typeof camera.zoomCenterByScaleFactor === 'function') {
        const original = camera.zoomCenterByScaleFactor.bind(camera);
        camera.zoomCenterByScaleFactor = (scaleFactor, dx, dy) => {
          updateZoom(scaleFactor);
          return original(scaleFactor, dx, dy);
        };
      }

      if (typeof camera.zoomToClientCoordinates === 'function') {
        const original = camera.zoomToClientCoordinates.bind(camera);
        camera.zoomToClientCoordinates = (x, y, scaleFactor, shouldAnimate) => {
          updateZoom(scaleFactor);
          return original(x, y, scaleFactor, shouldAnimate);
        };
      }

      if (typeof camera.setViewBox === 'function') {
        const original = camera.setViewBox.bind(camera);
        camera.setViewBox = (...args) => {
          zoom = 1;
          this.cameraZoom = zoom;
          this.applyStationVisibility(renderer);
          return original(...args);
        };
      }
    },

    zazzleMugPrint() {
      if (this.zazzleLink) {
        window.open(this.zazzleLink, '_blank');
        recordOpenClick(this.zazzleLink);
        return;
      }

      this.generatingPreview = true;
      getPrintableCanvas(this.scene).then(printableCanvas => {
        generateZazzleLink(printableCanvas).then(link => {
          this.zazzleLink = link;
          window.open(link, '_blank');
          recordOpenClick(link);
          this.generatingPreview = false;
        }).catch(e => {
          this.error = e;
          this.generatingPreview = false;
        });
      });
    }
  }
}

function compareLineRefs(a, b) {
  const ax = normalizeLineRef(a);
  const bx = normalizeLineRef(b);
  const groupA = lineGroupOrder(ax);
  const groupB = lineGroupOrder(bx);
  if (groupA !== groupB) return groupA - groupB;

  const aNum = extractLineNumber(ax);
  const bNum = extractLineNumber(bx);
  if (aNum !== null && bNum !== null && aNum !== bNum) return aNum - bNum;
  return ax.localeCompare(bx);
}

function normalizeLineRef(ref) {
  return String(ref).replace(/\s+/g, '').toUpperCase();
}

function lineGroupOrder(ref) {
  if (ref.startsWith('U')) return 0;
  if (ref.startsWith('S')) return 1;
  return 2;
}

function extractLineNumber(ref) {
  const match = ref.match(/^(?:U|S)(\d+)/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

function toRGBA(c) {
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}

function recordOpenClick(link) {
  if (typeof gtag === 'undefined') return;

  gtag('event', 'click', {
    'event_category': 'Outbound Link',
    'event_label': link
  });
}

function getQueryParam(key) {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get(key);
}

</script>

<style lang='stylus'>
@import('./vars.styl');

#app {
  margin: 8px;
  max-height: 100vh;
  position: absolute;
  z-index: 1;
  h3 {
    font-weight: normal;
  }
}

.can-drag {
  border: 1px solid transparent;
}

.drag-overlay {
  position: fixed;
  background: transparent;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
}

.overlay-active {
  border: 1px dashed highlight-color;
}
.overlay-active.exclusive {
  border-style: solid;
}

.controls {
  height: 48px;
  background: white;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  width: desktop-controls-width;
  justify-content: space-around;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 -1px 0px rgba(0,0,0,0.02);

  a {
    text-decoration: none;
    display: flex;
    justify-content: center;
    align-items: center;
    color: highlight-color;
    margin: 0;
    border: 0;
    &:hover {
      color: emphasis-background;
      background: highlight-color;
    }
  }
  a.try-another {
    flex: 1;
  }

  a.print-button {
    flex: 1;
    border-right: 1px solid border-color;
    &:focus {
      border: 1px dashed highlight-color;
    }
  }
}

.rail-status {
  width: desktop-controls-width;
  background: white;
  margin-top: 6px;
  padding: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 -1px 0px rgba(0,0,0,0.02);
  font-size: 12px;
}

.rail-title {
  font-weight: bold;
  margin-bottom: 4px;
}

.rail-loading {
  color: highlight-color;
  margin-bottom: 4px;
}

.rail-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 6px;
  font-size: 12px;
}

.rail-toggles label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.rail-errors {
  color: #b20000;
  margin-top: 4px;
}

.export-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1000;
}

.export-overlay-card {
  background: white;
  padding: 20px 22px;
  width: min(820px, 90vw);
  max-height: 90vh;
  overflow: auto;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}

.export-result {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.export-result img {
  width: 100%;
  height: auto;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.export-actions a {
  color: highlight-color;
  text-decoration: none;
}

.col {
    display: flex;
    flex: 1;
    select {
      margin-left: 14px;
    }
  }
.row {
  margin-top: 4px;
  display: flex;
  flex-direction: row;
  min-height: 32px;
}
.colors {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;

  .color-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 64px;
  }

  .color-label {
    font-size: 12px;
  }
}

a {
  border: 1px solid transparent;
  margin: -1px;
  text-decoration: none;
  color: highlight-color
}
a:focus {
  border: 1px dashed highlight-color;
  outline: none;
}
.print-window {
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border-top: 1px solid border-color;
  background: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  width: desktop-controls-width;
  padding: 8px;
  .row a {
    margin-right: 4px;
  }

  h3 {
    margin: 8px 0;
    text-align: right;
  }
}

.message {
  border-top: 1px solid border-color
  border-bottom: 1px solid border-color
  background: #F5F5F5;
}

.preview-actions {
  display: flex;
  padding: 8px 0;
  margin-left: -8px;
  margin-bottom: 14px;
  margin-top: 1px;
  width: desktop-controls-width;
  flex-direction: column;
  align-items: stretch;
  font-size: 14px;
  align-items: center;
  display: flex;

  .popup-help {
    text-align: center;
  }
}

.export-progress {
  margin: 8px 0 12px 0;
  width: desktop-controls-width;
}

.export-label {
  font-size: 12px;
  margin-bottom: 4px;
}

.export-bar {
  height: 6px;
  background: #e6e6e6;
  border-radius: 3px;
  overflow: hidden;
}

.export-bar-fill {
  height: 100%;
  background: highlight-color;
  width: 0;
  transition: width 0.1s linear;
}

.export-overlay {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background: rgba(247, 242, 232, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.export-overlay-card {
  background: white;
  padding: 16px 20px;
  width: 360px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.city-name {
  position: absolute;
  right: 32px;
  bottom: 54px;
  font-size: 24px;
  color: #434343;
  input {
    font-size: 24px;
  }
}

.license {
  text-align: right;
  position: fixed;
  font-family: labels-font;
  right: 32px;
  bottom: 32px;
  font-size: 12px;
  padding-right: 8px;
  a {
    text-decoration: none;
    display: inline-block;
  }
}

.station-tooltip {
  position: fixed;
  padding: 6px 8px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.95);
  color: #1d1d1d;
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  transform: translate(8px, -8px);
  pointer-events: none;
  z-index: 2000;
}

.station-tooltip-name {
  font-weight: 600;
}

.station-tooltip-lines {
  margin-top: 2px;
  color: rgba(0, 0, 0, 0.65);
}

.c-2 {
  flex: 2
}

@media (max-width: small-screen) {
  #app {
    width: 100%;
    margin: 0;

    .preview-actions,.error,
    .controls, .print-window {
      width: 100%;
    }
    .loading-container {
      font-size: 12px;
    }

    .print-window {
      font-size: 14px;
    }

  }
  .city-name  {
    right: 8px;
    bottom: 24px;
  }
  .license  {
    right: 8px;
    bottom: 8px;
  }
}

</style>
