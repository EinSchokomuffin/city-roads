<template>
  <find-place v-if='!placeFound' @loaded='onGridLoaded'></find-place>
  <div id="app">
    <div v-if='placeFound'>
      <div class='controls'>
        <a href="#" class='print-button' data-action='toggle-settings' @click.prevent='toggleSettings'>Customize...</a>
        <a v-if='!lockedToDefaultCity' href="#" class='try-another' @click.prevent='startOver'>Try another city</a>
        <a v-if='placeFound' href="#" class='reset-map' @click.prevent='resetMap'>Reset Map</a>
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

  <svg v-if='placeFound && (radiusOverlays.length || lineOverlays.length || lineTool.selecting)' class='map-overlay' :style='overlayStyle' :width='overlayBounds.width' :height='overlayBounds.height'>
    <defs>
      <mask v-for='radius in radiusOverlays' :key='`mask-${radius.id}`' :id='`radius-cutout-${radius.id}`'>
        <rect :width='overlayBounds.width' :height='overlayBounds.height' fill='white' />
        <circle v-if='radius.screen && radius.screen.r' :cx='radius.screen.cx' :cy='radius.screen.cy' :r='radius.screen.r' fill='black' />
      </mask>
      <clipPath v-if='berlinBorderPolygonsScreen.length' id='berlin-border-clip' clipPathUnits='userSpaceOnUse'>
        <polygon v-for='(poly, idx) in berlinBorderPolygonsScreen' :key='`berlin-${idx}`' :points='poly' />
      </clipPath>
    </defs>
    <g v-for='radius in radiusOverlays' :key='radius.id'>
      <rect v-if='radius.graySide === "outside"' :width='overlayBounds.width' :height='overlayBounds.height' fill='rgba(0,0,0,0.25)' :mask='`url(#radius-cutout-${radius.id})`' />
      <circle v-if='radius.graySide === "inside" && radius.screen && radius.screen.r' :cx='radius.screen.cx' :cy='radius.screen.cy' :r='radius.screen.r' fill='rgba(0,0,0,0.25)' />
      <circle v-if='radius.screen && radius.screen.r' :cx='radius.screen.cx' :cy='radius.screen.cy' :r='radius.screen.r' fill='transparent' stroke='rgba(0,0,0,0.45)' stroke-width='2' stroke-dasharray='6 6' />
    </g>
    <g v-for='line in lineOverlays' :key='line.id' :clip-path='berlinBorderClipUrl || null'>
      <polygon v-if='line.screen && line.screen.shade' :points='line.screen.shade' fill='rgba(0,0,0,0.25)' />
      <line v-if='line.screen && line.screen.x1 !== null' :x1='line.screen.x1' :y1='line.screen.y1' :x2='line.screen.x2' :y2='line.screen.y2' stroke='rgba(0,0,0,0.45)' stroke-width='2' stroke-dasharray='6 6' />
    </g>
    <g v-if='lineTool.selecting && lineTool.points.length'>
      <circle :cx='lineTool.points[0].x' :cy='lineTool.points[0].y' r='11' fill='rgba(255, 64, 129, 0.2)' />
      <circle :cx='lineTool.points[0].x' :cy='lineTool.points[0].y' r='7' fill='rgba(255, 64, 129, 0.85)' />
    </g>
  </svg>

  <div v-if='lineTool.selecting' class='selection-hint'>
    Gerade: Punkt {{lineTool.points.length + 1}}/2 waehlen
  </div>

  <div v-if='contextMenu.visible' ref='contextMenu' class='context-menu' :style='{left: contextMenu.x + "px", top: contextMenu.y + "px"}' @click.stop>
    <div class='menu-section'>
      <div class='menu-title'>Radius</div>
      <label class='menu-row'>
        <span>Radius (km)</span>
        <input type='number' min='0' step='0.1' v-model.number='radiusTool.km' @change='refreshOverlay' />
      </label>
      <label class='menu-row'>
        <span>Grauer Bereich</span>
        <select v-model='radiusTool.graySide' @change='refreshOverlay'>
          <option value='inside'>innen</option>
          <option value='outside'>aussen</option>
        </select>
      </label>
      <button type='button' class='menu-button' @click='applyRadiusFromMenu'>Radius hier setzen</button>
    </div>
    <div class='menu-divider'></div>
    <div class='menu-section'>
      <div class='menu-title'>Gerade</div>
      <label class='menu-row'>
        <span>Grauer Bereich</span>
        <select v-model='lineTool.graySide' @change='refreshOverlay'>
          <option value='left'>links</option>
          <option value='right'>rechts</option>
        </select>
      </label>
      <button type='button' class='menu-button' @click='startLineSelection'>Zwei Punkte wahlen</button>
    </div>
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
      exportResultName: '',
      contextMenu: {
        visible: false,
        x: 0,
        y: 0,
        world: null
      },
      overlayBounds: {
        left: 0,
        top: 0,
        width: 0,
        height: 0
      },
      radiusOverlays: [],
      lineOverlays: [],
      overlayIdSeed: 1,
      berlinBorderPolygons: [],
      berlinBorderPolygonsScreen: [],
      radiusTool: {
        km: 2,
        graySide: 'inside',
        center: null,
        radiusMeters: 0
      },
      lineTool: {
        graySide: 'left',
        points: [],
        pointsWorld: [],
        line: null,
        selecting: false
      },
      mapStateSaveTimer: null
    }
  },
  computed: {
    labelColorRGBA() {
      return toRGBA(this.labelColor);
    },
    stationLineDisplay() {
      return this.formatStationLines(this.stationTooltip.lines);
    },
    overlayStyle() {
      return {
        left: this.overlayBounds.left + 'px',
        top: this.overlayBounds.top + 'px'
      };
    },
    berlinBorderClipUrl() {
      if (!this.berlinBorderPolygonsScreen.length) return null;
      return 'url(#berlin-border-clip)';
    }
  },
  watch: {
    'radiusTool.km'() {
      this.refreshOverlay();
    },
    'radiusTool.graySide'() {
      this.refreshOverlay();
    },
    'lineTool.graySide'() {
      this.refreshOverlay();
    }
  },
  created() {
    bus.on('scene-transform', this.handleSceneTransform);
    bus.on('background-color', this.syncBackground);
    bus.on('line-color', this.syncLineColor);
    this.overlayManager = createOverlayManager();
  },
  mounted() {
    document.addEventListener('click', this.handleGlobalClick, true);
    document.addEventListener('keydown', this.handleGlobalKeyDown, true);
    window.addEventListener('resize', this.updateOverlayBounds, true);
  },
  beforeUnmount() {
    debugger;
    this.overlayManager.dispose();
    this.dispose();
    this.unbindStationClickHandler();
    this.unbindMapClickHandler();
    this.unbindContextMenu();
    if (this.mapStateSaveTimer) window.clearTimeout(this.mapStateSaveTimer);
    document.removeEventListener('click', this.handleGlobalClick, true);
    document.removeEventListener('keydown', this.handleGlobalKeyDown, true);
    window.removeEventListener('resize', this.updateOverlayBounds, true);
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
    resetMap() {
      this.clearOverlays();
      if (!this.scene) return;
      const renderer = this.scene.getRenderer();
      if (renderer && renderer.setViewBox && this.baseViewBox) {
        renderer.setViewBox(this.baseViewBox);
        if (renderer.renderFrame) renderer.renderFrame(true);
      }
      this.scheduleMapStateSave();
    },
    toggleSettings() {
      this.showSettings = !this.showSettings;
    },
    handleSceneTransform() {
      this.zazzleLink = null;
      this.applyStationVisibility();
      this.updateStationTooltipPosition();
      this.updateOverlayGeometry();
      this.scheduleMapStateSave();
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

      this.bindContextMenu(canvas);
      this.bindMapClickHandler();
      this.updateOverlayBounds();

      this.initZoomTracking();

      window.scene = this.scene;

      let gridLayer = new GridLayer();
      gridLayer.id = 'lines';
      gridLayer.setGrid(grid);
      this.scene.add(gridLayer)
      gridLayer.color = 'rgba(0, 0, 0, 0.15)';
      this.baseViewBox = gridLayer.getViewBox();

      this.restoreMapState();

      this.loadRailLayers(gridLayer);
    },

    startOver() {
      appState.unset('areaId');
      appState.unsetPlace();
      appState.unset('q');
      appState.enableCache();

      this.dispose();
      this.unbindMapClickHandler();
      this.unbindContextMenu();
      this.clearOverlays();
      this.closeContextMenu();
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
          this.berlinBorderPolygons = result.borderPolygons || [];
        }
        this.updateOverlayGeometry();
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
      if (this.lineTool.selecting) return;
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
    },
    bindContextMenu(canvas) {
      if (!canvas || this.contextMenuHandler) return;
      this.contextMenuHandler = (e) => this.handleCanvasContextMenu(e);
      canvas.addEventListener('contextmenu', this.contextMenuHandler);
    },
    unbindContextMenu() {
      if (!this.contextMenuHandler) return;
      const canvas = getCanvas();
      if (canvas) canvas.removeEventListener('contextmenu', this.contextMenuHandler);
      this.contextMenuHandler = null;
    },
    handleCanvasContextMenu(e) {
      if (!this.scene) return;
      e.preventDefault();
      const renderer = this.scene.getRenderer();
      if (!renderer || !renderer.getSceneCoordinate) return;
      const world = renderer.getSceneCoordinate(e.clientX, e.clientY);
      if (!world) return;
      this.contextMenu.world = {x: world[0], y: world[1]};
      this.contextMenu.x = e.clientX + 4;
      this.contextMenu.y = e.clientY + 4;
      this.contextMenu.visible = true;
    },
    closeContextMenu() {
      this.contextMenu.visible = false;
    },
    handleGlobalClick(e) {
      if (!this.contextMenu.visible) return;
      const menu = this.$refs.contextMenu;
      if (menu && menu.contains(e.target)) return;
      this.closeContextMenu();
    },
    handleGlobalKeyDown(e) {
      if (e.key === 'Escape') {
        this.closeContextMenu();
        this.lineTool.selecting = false;
      }
    },
    addRadiusOverlay(center, km, graySide) {
      const radiusMeters = km * 1000;
      this.radiusOverlays.push({
        id: this.overlayIdSeed++,
        center: {...center},
        radiusMeters,
        graySide,
        screen: null
      });
    },
    addLineOverlay(line, graySide) {
      this.lineOverlays.push({
        id: this.overlayIdSeed++,
        line,
        graySide,
        screen: null
      });
    },
    applyRadiusFromMenu() {
      if (!this.contextMenu.world || !this.scene) return;
      const km = Number(this.radiusTool.km);
      if (!Number.isFinite(km) || km <= 0) return;
      this.lineTool.points = [];
      this.lineTool.selecting = false;
      this.addRadiusOverlay(this.contextMenu.world, km, this.radiusTool.graySide);
      this.updateOverlayGeometry();
      this.closeContextMenu();
      this.scheduleMapStateSave();
    },
    startLineSelection() {
      this.lineTool.selecting = true;
      this.lineTool.points = [];
      this.lineTool.pointsWorld = [];
      this.lineTool.line = null;
      this.updateOverlayGeometry();
      this.closeContextMenu();
    },
    bindMapClickHandler() {
      if (!this.scene || this.mapClickHandler) return;
      const renderer = this.scene.getRenderer();
      if (!renderer || !renderer.on) return;
      this.mapClickHandler = (e) => this.handleMapClick(e, renderer);
      renderer.on('click', this.mapClickHandler);
    },
    unbindMapClickHandler() {
      if (!this.mapClickHandler || !this.scene) return;
      const renderer = this.scene.getRenderer();
      if (renderer && renderer.off) renderer.off('click', this.mapClickHandler);
      this.mapClickHandler = null;
    },
    handleMapClick(e, renderer) {
      if (!this.lineTool.selecting) return;
      const original = e && e.originalEvent;
      if (original && original.button === 2) return;
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
      const screenPoint = renderer && renderer.getClientCoordinate
        ? renderer.getClientCoordinate(e.x, e.y, 0)
        : null;
      this.lineTool.points.push(screenPoint ? {x: screenPoint.x, y: screenPoint.y} : {x: e.x, y: e.y});
      this.lineTool.pointsWorld.push({x: e.x, y: e.y});
      this.clearStationTooltip();

      if (this.lineTool.pointsWorld.length < 2) return;

      const a = this.lineTool.pointsWorld[0];
      const b = this.lineTool.pointsWorld[1];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const len = Math.hypot(vx, vy);
      if (!Number.isFinite(len) || len === 0) {
        this.lineTool.selecting = false;
        return;
      }
      const dir = {x: -vy / len, y: vx / len};
      const mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
      this.lineTool.line = {mid, dir, a, b};
      this.addLineOverlay({mid, dir, a, b}, this.lineTool.graySide);
      this.lineTool.selecting = false;
      this.updateOverlayGeometry();
      this.scheduleMapStateSave();
    },
    clearOverlays() {
      this.radiusOverlays = [];
      this.lineOverlays = [];
      this.berlinBorderPolygonsScreen = [];
      this.lineTool.points = [];
      this.lineTool.pointsWorld = [];
      this.lineTool.line = null;
      this.lineTool.selecting = false;
      this.scheduleMapStateSave();
    },
    updateOverlayBounds() {
      const canvas = getCanvas();
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      this.overlayBounds.left = rect.left;
      this.overlayBounds.top = rect.top;
      this.overlayBounds.width = rect.width;
      this.overlayBounds.height = rect.height;
      this.updateOverlayGeometry();
    },
    updateOverlayGeometry() {
      if (!this.scene) return;
      this.updateBerlinBorderClip();
      this.updateLineSelectionPreview();
      this.updateRadiusOverlays();
      this.updateLineOverlays();
    },
    updateLineSelectionPreview() {
      if (!this.lineTool.selecting || !this.lineTool.pointsWorld.length) return;
      const renderer = this.scene && this.scene.getRenderer();
      if (!renderer || !renderer.getClientCoordinate) return;
      this.lineTool.points = this.lineTool.pointsWorld
        .map(p => renderer.getClientCoordinate(p.x, p.y, 0))
        .filter(Boolean)
        .map(p => ({x: p.x, y: p.y}));
    },
    updateRadiusOverlays() {
      const renderer = this.scene && this.scene.getRenderer();
      if (!renderer || !renderer.getClientCoordinate) return;
      this.radiusOverlays.forEach(radius => {
        if (!radius.center || !radius.radiusMeters) {
          radius.screen = null;
          return;
        }
        const center = renderer.getClientCoordinate(radius.center.x, radius.center.y, 0);
        if (!center) {
          radius.screen = null;
          return;
        }
        const edge = renderer.getClientCoordinate(radius.center.x + radius.radiusMeters, radius.center.y, 0);
        if (!edge) {
          radius.screen = null;
          return;
        }
        const r = Math.hypot(edge.x - center.x, edge.y - center.y);
        radius.screen = {cx: center.x, cy: center.y, r};
      });
    },
    updateLineOverlays() {
      const renderer = this.scene && this.scene.getRenderer();
      if (!renderer || !renderer.getClientCoordinate) return;
      const bounds = {width: this.overlayBounds.width, height: this.overlayBounds.height};
      this.lineOverlays.forEach(line => {
        if (!line.line) {
          line.screen = null;
          return;
        }
        const {mid, dir} = line.line;
        const midScreen = renderer.getClientCoordinate(mid.x, mid.y, 0);
        const dirScreen = renderer.getClientCoordinate(mid.x + dir.x, mid.y + dir.y, 0);
        if (!midScreen || !dirScreen) {
          line.screen = null;
          return;
        }
        const dx = dirScreen.x - midScreen.x;
        const dy = dirScreen.y - midScreen.y;
        const len = Math.hypot(dx, dy);
        if (!Number.isFinite(len) || len === 0) {
          line.screen = null;
          return;
        }
        const direction = {x: dx / len, y: dy / len};
        const intersections = getLineRectIntersections(midScreen, direction, bounds);
        if (intersections.length < 2) {
          line.screen = null;
          return;
        }

        const leftSide = line.graySide === 'left';
        line.screen = {
          x1: intersections[0].x,
          y1: intersections[0].y,
          x2: intersections[1].x,
          y2: intersections[1].y,
          shade: buildHalfPlanePolygon(midScreen, direction, bounds, leftSide)
        };
      });
    },
    updateBerlinBorderClip() {
      if (!this.scene || !this.berlinBorderPolygons.length) {
        this.berlinBorderPolygonsScreen = [];
        return;
      }
      const renderer = this.scene.getRenderer();
      if (!renderer || !renderer.getClientCoordinate) return;
      const polygons = [];
      this.berlinBorderPolygons.forEach(poly => {
        const points = poly.map(p => renderer.getClientCoordinate(p.x, p.y, 0)).filter(Boolean);
        if (points.length < 3) return;
        const encoded = points.map(p => `${p.x},${p.y}`).join(' ');
        if (encoded) polygons.push(encoded);
      });
      this.berlinBorderPolygonsScreen = polygons;
    },
    refreshOverlay() {
      this.updateOverlayGeometry();
      this.scheduleMapStateSave();
    },
    getMapStateKey() {
      const areaId = appState.get('areaId');
      const osmId = appState.get('osm_id');
      const name = appState.get('q');
      return `mapState:${areaId || osmId || name || 'default'}`;
    },
    persistMapStateLocal(payload) {
      try {
        const key = this.getMapStateKey();
        window.localStorage.setItem(key, JSON.stringify(payload));
      } catch (e) {
        // Ignore storage errors
      }
    },
    restoreMapState() {
      if (!this.scene) return;
      let payload = null;
      try {
        const key = this.getMapStateKey();
        const raw = window.localStorage.getItem(key);
        if (raw) payload = JSON.parse(raw);
      } catch (e) {
        payload = null;
      }
      if (!payload) return;

      const renderer = this.scene.getRenderer();
      if (payload.viewBox && renderer && renderer.setViewBox) {
        renderer.setViewBox(payload.viewBox);
        if (renderer.renderFrame) renderer.renderFrame(true);
      }

      const radiusOverlays = Array.isArray(payload.radiusOverlays) ? payload.radiusOverlays : [];
      const lineOverlays = Array.isArray(payload.lineOverlays) ? payload.lineOverlays : [];
      if (!radiusOverlays.length && payload.radius) radiusOverlays.push(payload.radius);
      if (!lineOverlays.length && payload.line) lineOverlays.push({line: payload.line, graySide: payload.line.graySide});

      this.radiusOverlays = radiusOverlays
        .filter(radius => radius && radius.center && Number.isFinite(radius.radiusMeters) && radius.radiusMeters > 0)
        .map(radius => ({
          id: this.overlayIdSeed++,
          center: radius.center,
          radiusMeters: radius.radiusMeters,
          graySide: radius.graySide || 'inside',
          screen: null
        }));

      this.lineOverlays = lineOverlays
        .filter(entry => entry && entry.line && entry.line.mid && entry.line.dir)
        .map(entry => ({
          id: this.overlayIdSeed++,
          line: entry.line,
          graySide: entry.graySide || entry.line.graySide || 'left',
          screen: null
        }));

      if (this.radiusOverlays.length) {
        const first = this.radiusOverlays[0];
        if (Number.isFinite(first.radiusMeters)) this.radiusTool.km = first.radiusMeters / 1000;
      }

      if (this.lineOverlays.length) {
        const first = this.lineOverlays[0];
        this.lineTool.graySide = first.graySide;
      }

      this.updateOverlayGeometry();
    },
    scheduleMapStateSave() {
      if (!this.scene) return;
      if (this.mapStateSaveTimer) window.clearTimeout(this.mapStateSaveTimer);
      const delay = Number.isFinite(config.mapStateSaveDebounceMs) ? config.mapStateSaveDebounceMs : 400;
      this.mapStateSaveTimer = window.setTimeout(() => {
        this.mapStateSaveTimer = null;
        this.saveMapState();
      }, delay);
    },
    saveMapState() {
      if (!this.scene) return;
      const renderer = this.scene.getRenderer();
      const viewBox = renderer && renderer.getViewBox ? renderer.getViewBox() : null;
      const radiusOverlays = this.radiusOverlays
        .filter(radius => radius.center && Number.isFinite(radius.radiusMeters) && radius.radiusMeters > 0)
        .map(radius => ({
          center: radius.center,
          radiusMeters: radius.radiusMeters,
          graySide: radius.graySide
        }));
      const lineOverlays = this.lineOverlays
        .filter(line => line.line && line.line.mid && line.line.dir)
        .map(line => ({
          line: line.line,
          graySide: line.graySide
        }));
      const payload = {
        viewBox,
        radiusOverlays,
        lineOverlays,
        radius: radiusOverlays.length ? radiusOverlays[0] : null,
        line: lineOverlays.length ? {
          mid: lineOverlays[0].line.mid,
          dir: lineOverlays[0].line.dir,
          graySide: lineOverlays[0].graySide
        } : null
      };
      this.persistMapStateLocal(payload);
      if (!config.mapStateEndpoint) return;
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const blob = new Blob([body], {type: 'application/json'});
        const queued = navigator.sendBeacon(config.mapStateEndpoint, blob);
        if (queued) return;
      }
      fetch(config.mapStateEndpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body,
        keepalive: true
      }).catch(() => {});
    }
  }
}

function getLineRectIntersections(point, direction, bounds) {
  const hits = [];
  const minX = 0;
  const maxX = bounds.width;
  const minY = 0;
  const maxY = bounds.height;
  const dx = direction.x;
  const dy = direction.y;

  if (dx !== 0) {
    let t = (minX - point.x) / dx;
    let y = point.y + t * dy;
    if (y >= minY && y <= maxY) hits.push({x: minX, y});
    t = (maxX - point.x) / dx;
    y = point.y + t * dy;
    if (y >= minY && y <= maxY) hits.push({x: maxX, y});
  }

  if (dy !== 0) {
    let t = (minY - point.y) / dy;
    let x = point.x + t * dx;
    if (x >= minX && x <= maxX) hits.push({x, y: minY});
    t = (maxY - point.y) / dy;
    x = point.x + t * dx;
    if (x >= minX && x <= maxX) hits.push({x, y: maxY});
  }

  return uniquePoints(hits).slice(0, 2);
}

function buildHalfPlanePolygon(point, direction, bounds, leftSide) {
  const normal = {x: -direction.y, y: direction.x};
  const corners = [
    {x: 0, y: 0},
    {x: bounds.width, y: 0},
    {x: bounds.width, y: bounds.height},
    {x: 0, y: bounds.height}
  ];

  const candidates = corners.filter(corner => {
    const dot = (corner.x - point.x) * normal.x + (corner.y - point.y) * normal.y;
    return leftSide ? dot >= 0 : dot <= 0;
  });

  const intersections = getLineRectIntersections(point, direction, bounds);
  if (intersections.length < 2) return '';
  candidates.push(intersections[0], intersections[1]);

  const centroid = candidates.reduce((acc, p) => ({
    x: acc.x + p.x / candidates.length,
    y: acc.y + p.y / candidates.length
  }), {x: 0, y: 0});

  candidates.sort((a, b) => Math.atan2(a.y - centroid.y, a.x - centroid.x) - Math.atan2(b.y - centroid.y, b.x - centroid.x));
  return candidates.map(p => `${p.x},${p.y}`).join(' ');
}

function uniquePoints(points) {
  const unique = [];
  const eps = 0.01;
  points.forEach(p => {
    const exists = unique.some(u => Math.hypot(u.x - p.x, u.y - p.y) < eps);
    if (!exists) unique.push(p);
  });
  return unique;
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
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
@import('./vars.styl');

#app {
  margin: 10px;
  max-height: 100vh;
  position: absolute;
  z-index: 1;
  font-family: ui-font;
  color: primary-text;
  letter-spacing: 0.1px;
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
  height: 52px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(245, 249, 248, 0.98));
  border: 1px solid border-color;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  width: desktop-controls-width;
  justify-content: space-around;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);

  a {
    text-decoration: none;
    display: flex;
    justify-content: center;
    align-items: center;
    color: primary-text;
    margin: 0;
    border: 0;
    font-weight: 500;
    font-size: 14px;
    transition: background 0.18s ease, color 0.18s ease;
    &:hover {
      color: emphasis-background;
      background: highlight-color;
    }
    &:focus-visible {
      outline: 2px solid rgba(15, 118, 110, 0.5);
      outline-offset: -2px;
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

  a.reset-map {
    flex: 1;
    border-left: 1px solid border-color;
  }
}

.map-overlay {
  position: fixed;
  pointer-events: none;
  z-index: 1200;
  width: 100%;
  height: 100%;
}

.selection-hint {
  position: fixed;
  right: 16px;
  top: 16px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 10px;
  font-size: 12px;
  box-shadow: 0 10px 18px rgba(15, 23, 42, 0.12);
  z-index: 2600;
}

.context-menu {
  position: fixed;
  z-index: 2700;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(245, 249, 248, 0.98));
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 12px;
  padding: 12px;
  width: 240px;
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.22);
  font-size: 12px;
}

.menu-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.menu-title {
  font-weight: 600;
}

.menu-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  input,
  select {
    width: 110px;
    border-radius: 8px;
    border: 1px solid rgba(15, 23, 42, 0.16);
    padding: 4px 6px;
  }
}

.menu-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
  margin: 8px 0;
}

.menu-button {
  border: 1px solid rgba(15, 23, 42, 0.14);
  background: rgba(244, 247, 246, 0.9);
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  text-align: center;
  font-weight: 500;
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.menu-button:hover {
  background: highlight-color;
  color: white;
}

.menu-danger {
  border-color: rgba(178, 0, 0, 0.4);
}

.rail-status {
  width: desktop-controls-width;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 250, 249, 0.98));
  margin-top: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid border-color;
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.12);
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
  background: rgba(10, 15, 18, 0.45);
  z-index: 1000;
}

.export-overlay-card {
  background: white;
  padding: 22px 24px;
  width: min(820px, 90vw);
  max-height: 90vh;
  overflow: auto;
  border-radius: 16px;
  box-shadow: 0 18px 46px rgba(15, 23, 42, 0.28);
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
  transition: color 0.18s ease, background 0.18s ease;
}
a:focus {
  border: 1px dashed highlight-color;
  outline: none;
}
.print-window {
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border: 1px solid border-color;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 250, 249, 0.98));
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
  width: desktop-controls-width;
  padding: 12px;
  border-radius: 12px;
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
  background: rgba(245, 247, 246, 0.92);
  border-radius: 10px;
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
  background: rgba(15, 23, 42, 0.12);
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
  background: rgba(10, 15, 18, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.export-overlay-card {
  background: white;
  padding: 18px 22px;
  width: 360px;
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.24);
  border-radius: 14px;
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
  background: rgba(255, 255, 255, 0.98);
  color: #1d1d1d;
  border: 1px solid rgba(15, 23, 42, 0.18);
  border-radius: 8px;
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.18);
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
