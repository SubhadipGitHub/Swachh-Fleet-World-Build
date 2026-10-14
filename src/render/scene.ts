import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Fog,
  LineSegments,
  Points,
  PointsMaterial,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import type { WeatherMode } from '../config/scenario';
import { HIGHWAY_CLASSES } from '../geo/snapshot';
import { localToLatLon } from '../geo/project';
import type { DecodedSnapshot } from '../geo/snapshot';
import { sunPosition } from '../geo/sun';
import type { RoadGraph } from '../routing/graph';
import type { SpeedModel } from '../routing/travel-time';
import { toUtcMs } from '../sim/clock';
import type { VehiclePlan } from '../sim/world';
import { F, FRAME_STRIDE, type FromSim, type MapView } from '../workers/protocol';
import { buildAgents, buildFacilities, facilityCentre, type AgentLayer } from './agents';
import { BackgroundTraffic } from './bg-traffic';
import { lightingFor, type LightOverride, type Lighting } from './lighting';
import { PlaceLabels, placeLabels, type LabelGroup } from './labels';
import { buildAreas, buildGround, buildRoads, buildWardLines } from './map-meshes';
import { PALETTE } from './palette';
import { TRAIL_SECONDS, TrailBuffer, trailsEnabled } from './trails';

export type Quality = 'high' | 'medium' | 'low';
export type Selection =
  | { readonly kind: 'vehicle'; readonly index: number }
  | { readonly kind: 'bin'; readonly index: number }
  | { readonly kind: 'blackSpot'; readonly index: number }
  | { readonly kind: 'facility'; readonly index: number };
export type AreaId = 'overview' | 'hsr' | 'koramangala' | 'transfer-points' | 'kcdc';

type Frame = Extract<FromSim, { type: 'frame' }>;

const QUALITY = {
  high: { shadows: 2048, pixelRatio: 2, bgCars: 200 },
  medium: { shadows: 1024, pixelRatio: 1.5, bgCars: 120 },
  low: { shadows: 0, pixelRatio: 1, bgCars: 60 },
} as const;
const PICK_RADIUS_PX = 16;
const RAIN_STREAKS = 1800;
const STREET_LIGHT_SPACING_M = 45;
const NIGHT_BACKGROUND = new Color('#0d1012');
const GLIDE_MS = 900;
const FOLLOW_DISTANCE_M = 220;

/** Detects a software renderer (CI, VMs) and small touch screens to choose a quality tier (AD-10). */
export function detectQuality(gl: WebGL2RenderingContext): Quality {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'low';
  if (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820) return 'medium';
  return 'high';
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Glide {
  readonly fromTarget: Vector3;
  readonly toTarget: Vector3;
  readonly fromPos: Vector3;
  readonly toPos: Vector3;
  readonly start: number;
}

export class WorldScene {
  readonly renderer: WebGLRenderer;
  readonly camera: PerspectiveCamera;
  readonly controls: MapControls;
  private readonly scene = new Scene();
  private readonly sun: DirectionalLight;
  private readonly hemi: HemisphereLight;
  private readonly overlay: HTMLDivElement;
  private readonly selectionLabel: HTMLDivElement;
  private readonly ring: Mesh;
  private readonly routeLine: Line;
  private readonly beatLine: Line;
  private agents: AgentLayer | null = null;
  private bg: BackgroundTraffic | null = null;
  private view: MapView | null = null;
  private graph: RoadGraph | null = null;
  private origin: DecodedSnapshot['manifest']['origin'] | null = null;
  private prev: Frame | null = null;
  private curr: Frame | null = null;
  private prevAt = 0;
  private currAt = 0;
  private bgT = -1;
  /** Interpolated vehicle positions this frame (x, y, heading, visible). */
  private positions: Float32Array = new Float32Array(0);
  private selection: Selection | null = null;
  private following = false;
  private glide: Glide | null = null;
  /** W-8, CR-2: area, ward and facility names floating in the world. */
  private labels: PlaceLabels | null = null;
  private lastPlanKey = '';
  private lastRender = performance.now();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private frameListeners: (() => void)[] = [];
  readonly quality: Quality;
  // M2: weather, night and trails.
  private roads: Mesh | null = null;
  private weather: WeatherMode = 'clear';
  private override: LightOverride = 'auto';
  private lighting: Lighting = lightingFor(30);
  private streetLights: Points | null = null;
  private readonly headlights: Points;
  private readonly rain: LineSegments;
  private readonly trailLines: LineSegments;
  private trails: TrailBuffer[] = [];
  private simSpeed = 60;
  private lastTrailT = -1;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.quality = detectQuality(this.renderer.getContext() as WebGL2RenderingContext);
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.setClearColor(PALETTE.background);
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '3D map of the ward cluster');
    host.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(45, 1, 2, 40_000);
    this.camera.position.set(0, 4600, 3600);
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.maxPolarAngle = 1.3;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 9000;
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.addEventListener('start', () => {
      this.glide = null;
    });

    this.hemi = new HemisphereLight('#e6eef5', '#3a3a34', 1.6);
    this.scene.add(this.hemi, new AmbientLight('#ffffff', 0.25));
    this.sun = new DirectionalLight('#fff4e0', 2.2);
    this.sun.castShadow = q.shadows > 0;
    this.sun.shadow.mapSize.set(q.shadows || 1, q.shadows || 1);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.ring = new Mesh(new RingGeometry(5, 6.5, 40).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.9, depthTest: false }));
    this.ring.renderOrder = 20;
    this.ring.visible = false;
    this.routeLine = new Line(new BufferGeometry(), new LineBasicMaterial({ color: PALETTE.accent, depthTest: false }));
    this.beatLine = new Line(new BufferGeometry(), new LineBasicMaterial({ color: '#8fd3b0', transparent: true, opacity: 0.35, depthTest: false }));
    this.routeLine.renderOrder = 15;
    this.beatLine.renderOrder = 14;
    this.scene.add(this.ring, this.routeLine, this.beatLine);

    this.headlights = new Points(new BufferGeometry(), new PointsMaterial({ color: '#fff3c4', size: 5, sizeAttenuation: false, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    this.headlights.frustumCulled = false;
    this.headlights.visible = false;
    this.headlights.renderOrder = 11;
    const rainPos = new Float32Array(RAIN_STREAKS * 6);
    const rainGeom = new BufferGeometry();
    rainGeom.setAttribute('position', new BufferAttribute(rainPos, 3).setUsage(DynamicDrawUsage));
    this.rain = new LineSegments(rainGeom, new LineBasicMaterial({ color: '#9fb6c9', transparent: true, opacity: 0.45, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    const trailGeom = new BufferGeometry();
    trailGeom.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
    this.trailLines = new LineSegments(trailGeom, new LineBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.55, depthTest: false }));
    this.trailLines.frustumCulled = false;
    this.trailLines.renderOrder = 12;
    this.scene.add(this.headlights, this.rain, this.trailLines);

    this.overlay = document.createElement('div');
    this.overlay.className = 'label-layer';
    host.appendChild(this.overlay);
    this.selectionLabel = document.createElement('div');
    this.selectionLabel.className = 'selection-label';
    this.selectionLabel.dataset.testid = 'selection-label';
    this.selectionLabel.hidden = true;
    this.overlay.appendChild(this.selectionLabel);

    new ResizeObserver(() => {
      this.resize();
    }).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.animate();
    });
  }

  private resize(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setMap(snapshot: DecodedSnapshot, graph: RoadGraph, view: MapView, speedModel: SpeedModel): void {
    this.graph = graph;
    this.view = view;
    this.origin = snapshot.manifest.origin;
    const q = QUALITY[this.quality];
    this.roads = buildRoads(graph);
    this.scene.add(buildGround(), buildAreas(snapshot), this.roads, buildWardLines(snapshot), buildFacilities(view));
    this.streetLights = buildStreetLights(graph);
    this.scene.add(this.streetLights);
    this.trails = view.vehicles.map(() => new TrailBuffer(48));
    this.agents = buildAgents(view);
    this.scene.add(this.agents.group);
    this.bg = new BackgroundTraffic(graph, speedModel, q.bgCars, 7);
    this.scene.add(this.bg.group);
    this.positions = new Float32Array(view.vehicles.length * 4);
    this.labels = new PlaceLabels(placeLabels(view));
    this.scene.add(this.labels.group);
  }

  /** Place labels at least half faded in and on screen, at their card centres (debug hook, CR2-7). */
  shownLabels(): { group: LabelGroup; text: string; x: number; y: number }[] {
    const out: { group: LabelGroup; text: string; x: number; y: number }[] = [];
    for (const { label, centreHeight } of this.labels?.shown() ?? []) {
      const s = this.toScreen(label.x, label.y, centreHeight);
      if (s) out.push({ group: label.group, text: label.text, ...s });
    }
    return out;
  }

  /** X-1: weather visuals (rain and wet roads, haze, heatwave grade). The simulation side runs in the worker. */
  setWeather(mode: WeatherMode): void {
    this.weather = mode;
    this.rain.visible = mode === 'monsoon';
    if (this.roads) (this.roads.material as MeshBasicMaterial).color.set(mode === 'monsoon' ? '#8d9aa8' : '#ffffff');
    this.scene.fog = mode === 'haze' ? new Fog('#9aa3a6', 300, 3200) : null;
    this.hemi.color.set(mode === 'heatwave' ? '#ffe2b8' : '#e6eef5');
    this.sun.color.set(mode === 'heatwave' ? '#ffd29a' : '#fff4e0');
  }

  /** D-2 day/night toggle: forces the view's lighting only. */
  setLightOverride(o: LightOverride): void {
    this.override = o;
  }

  weatherShown(): WeatherMode {
    return this.weather;
  }

  lightingState(): { phase: Lighting['phase']; override: LightOverride } {
    return { phase: this.lighting.phase, override: this.override };
  }

  setSimSpeed(speed: number): void {
    this.simSpeed = speed;
  }

  onFrame(frame: Frame): void {
    const now = performance.now();
    if (frame.reqId !== null || !this.curr) {
      // A jump (skip) or the first frame: no interpolation across it.
      this.prev = frame;
      this.prevAt = now - 1;
    } else {
      this.prev = this.curr;
      this.prevAt = this.currAt;
    }
    this.curr = frame;
    this.currAt = now;
  }

  /** Calls `cb` once after the next rendered frame. */
  afterNextRender(cb: () => void): void {
    this.frameListeners.push(cb);
  }

  /** Simulated time shown on screen (interpolated). */
  simTime(): number {
    if (!this.prev || !this.curr) return 0;
    return this.prev.t + (this.curr.t - this.prev.t) * this.alpha();
  }

  private alpha(): number {
    const span = this.currAt - this.prevAt;
    return span <= 0 ? 1 : Math.min(1, Math.max(0, (performance.now() - this.currAt) / span));
  }

  private interpolate(): void {
    const prev = this.prev;
    const curr = this.curr;
    const agents = this.agents;
    if (!prev || !curr || !agents || !this.view) return;
    const a = this.alpha();
    const n = this.view.vehicles.length;
    const fleet: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const o = i * FRAME_STRIDE;
      const c = curr.vehicles;
      const p = prev.vehicles.length === c.length ? prev.vehicles : c;
      // Parked to driving or a long hop (a re-route at a yard): snap instead of sliding through buildings.
      const jump = Math.hypot(c[o + F.x]! - p[o + F.x]!, c[o + F.y]! - p[o + F.y]!) > 400;
      const k = jump ? 1 : a;
      const x = p[o + F.x]! + (c[o + F.x]! - p[o + F.x]!) * k;
      const y = p[o + F.y]! + (c[o + F.y]! - p[o + F.y]!) * k;
      let dh = c[o + F.heading]! - p[o + F.heading]!;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const heading = p[o + F.heading]! + dh * k;
      const visible = c[o + F.visible]! > 0;
      this.positions.set([x, y, heading, visible ? 1 : 0], i * 4);
      agents.setVehicle(i, x, y, heading, visible);
      if (visible) fleet.push({ x, y });
    }
    curr.bins.forEach((_, j) => {
      if (j % 2 === 0) agents.setBinFill(j / 2, curr.bins[j]!);
    });
    curr.spots.forEach((size, j) => {
      agents.setSpotSize(j, size);
    });
    agents.commit();
    if (this.bg) {
      const t = this.simTime();
      if (this.bgT < 0 || t - this.bgT > 600 || t < this.bgT) this.bgT = t;
      this.bg.step(t - this.bgT, t);
      this.bgT = t;
      this.bg.render(fleet);
    }
  }

  /** Local (x, y) of a selection right now. */
  positionOf(sel: Selection): { x: number; y: number } | null {
    const view = this.view;
    if (!view) return null;
    switch (sel.kind) {
      case 'vehicle': {
        if (this.positions[sel.index * 4 + 3] === 0) return null;
        return { x: this.positions[sel.index * 4]!, y: this.positions[sel.index * 4 + 1]! };
      }
      case 'bin': {
        const b = view.bins[sel.index];
        return b ? { x: b.x + 3, y: b.y + 3 } : null;
      }
      case 'blackSpot': {
        const s = view.blackSpots[sel.index];
        return s ? { x: s.x - 3, y: s.y - 3 } : null;
      }
      case 'facility': {
        const f = view.facilities[sel.index];
        return f ? facilityCentre(f) : null;
      }
    }
  }

  /** Screen position in canvas CSS pixels, or null if behind the camera or outside the canvas. */
  toScreen(x: number, y: number, height = 1): { x: number; y: number } | null {
    const v = new Vector3(x, height, -y).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const sx = ((v.x + 1) / 2) * w;
    const sy = ((1 - v.y) / 2) * h;
    if (sx < 0 || sy < 0 || sx > w || sy > h) return null;
    return { x: sx, y: sy };
  }

  /** Every pickable object, with its screen position (vehicles first, then bins, black spots, facilities). */
  private pickables(): { sel: Selection; screen: { x: number; y: number } }[] {
    const view = this.view;
    if (!view || !this.curr) return [];
    const out: { sel: Selection; screen: { x: number; y: number } }[] = [];
    const add = (sel: Selection, height: number): void => {
      const p = this.positionOf(sel);
      if (!p) return;
      const s = this.toScreen(p.x, p.y, height);
      if (s) out.push({ sel, screen: s });
    };
    view.vehicles.forEach((_, i) => {
      add({ kind: 'vehicle', index: i }, 1);
    });
    view.bins.forEach((_, i) => {
      add({ kind: 'bin', index: i }, 0.7);
    });
    view.blackSpots.forEach((_, i) => {
      if ((this.curr?.spots[i] ?? 0) > 0) add({ kind: 'blackSpot', index: i }, 1);
    });
    view.facilities.forEach((_, i) => {
      add({ kind: 'facility', index: i }, 3);
    });
    return out;
  }

  /** The nearest pickable within the pick radius of a canvas point, vehicles winning ties. */
  pick(sx: number, sy: number): Selection | null {
    let best: Selection | null = null;
    let bestD = PICK_RADIUS_PX;
    for (const { sel, screen } of this.pickables()) {
      const d = Math.hypot(screen.x - sx, screen.y - sy);
      if (d < bestD) {
        bestD = d;
        best = sel;
      }
    }
    return best;
  }

  /** A canvas point with nothing pickable within `clear` px and no UI on top, or null. */
  emptyGroundPoint(clear = 30): { x: number; y: number } | null {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const items = this.pickables();
    for (let fy = 0.35; fy <= 0.9; fy += 0.05) {
      for (let fx = 0.1; fx <= 0.9; fx += 0.05) {
        const x = rect.width * fx;
        const y = rect.height * fy;
        if (items.some((it) => Math.hypot(it.screen.x - x, it.screen.y - y) < clear)) continue;
        const el = document.elementFromPoint(rect.left + x, rect.top + y);
        if (el === canvas) return { x, y };
      }
    }
    return null;
  }

  select(sel: Selection | null, glide = true): void {
    this.selection = sel;
    this.following = sel?.kind === 'vehicle';
    this.lastPlanKey = '';
    this.setPlan(null);
    if (!sel) {
      this.ring.visible = false;
      this.selectionLabel.hidden = true;
      return;
    }
    const p = this.positionOf(sel);
    if (p && glide) this.glideTo(p.x, p.y, FOLLOW_DISTANCE_M);
  }

  setLabel(text: string): void {
    this.selectionLabel.textContent = text;
  }

  isFollowing(): boolean {
    return this.following;
  }

  /** Draws the selected vehicle's remaining route and its beat (I-6). */
  setPlan(plan: VehiclePlan | null): void {
    const g = this.graph;
    const key = plan ? `${plan.remainingRoute.length}:${plan.remainingRoute[0] ?? -1}:${plan.beatEdges.length}` : '';
    if (key === this.lastPlanKey) return;
    this.lastPlanKey = key;
    const line = (edges: readonly number[], lift: number): BufferGeometry => {
      const pos: number[] = [];
      if (g) {
        for (const e of edges) {
          for (let k = g.shapeStart[e]!; k < g.shapeStart[e + 1]!; k++) pos.push(g.shapeXY[2 * k]!, lift, -g.shapeXY[2 * k + 1]!);
        }
      }
      const geom = new BufferGeometry();
      geom.setAttribute('position', new Float32BufferAttribute(pos, 3));
      return geom;
    };
    this.routeLine.geometry.dispose();
    this.beatLine.geometry.dispose();
    this.routeLine.geometry = line(plan?.remainingRoute ?? [], 1.2);
    this.beatLine.geometry = line(plan?.beatEdges ?? [], 0.9);
  }

  glideTo(x: number, y: number, distance: number): void {
    const toTarget = new Vector3(x, 0, -y);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.35) dir.setY(0.6).normalize();
    const toPos = toTarget.clone().add(dir.multiplyScalar(distance));
    if (this.reducedMotion) {
      this.controls.target.copy(toTarget);
      this.camera.position.copy(toPos);
      return;
    }
    this.glide = { fromTarget: this.controls.target.clone(), toTarget, fromPos: this.camera.position.clone(), toPos, start: performance.now() };
  }

  flyToArea(area: AreaId): void {
    const view = this.view;
    if (!view) return;
    const wardCentre = (keys: string[]): { x: number; y: number } => {
      const pts = view.wards.filter((w) => keys.includes(w.key)).flatMap((w) => w.rings.flat());
      return { x: pts.reduce((a, p) => a + p[0], 0) / Math.max(1, pts.length), y: pts.reduce((a, p) => a + p[1], 0) / Math.max(1, pts.length) };
    };
    this.select(null);
    switch (area) {
      case 'overview':
        this.glideTo(0, 0, 5800);
        return;
      case 'hsr': {
        const c = wardCentre(['South-72']);
        this.glideTo(c.x, c.y, 2200);
        return;
      }
      case 'koramangala': {
        const c = wardCentre(['South-28', 'South-29']);
        this.glideTo(c.x, c.y, 2400);
        return;
      }
      case 'transfer-points': {
        const tps = view.facilities.filter((f) => f.kind === 'transfer-point');
        this.glideTo(tps.reduce((a, f) => a + f.x, 0) / Math.max(1, tps.length), tps.reduce((a, f) => a + f.y, 0) / Math.max(1, tps.length), 3600);
        return;
      }
      case 'kcdc': {
        const k = view.facilities.find((f) => f.kind === 'kcdc');
        if (k) this.glideTo(facilityCentre(k).x, facilityCentre(k).y, 420);
        return;
      }
    }
  }

  private updateRain(dt: number): void {
    if (!this.rain.visible) return;
    const pos = this.rain.geometry.getAttribute('position') as BufferAttribute;
    const arr = pos.array as Float32Array;
    const t = this.controls.target;
    const span = Math.min(1200, Math.max(200, this.camera.position.distanceTo(t)));
    const fall = 40 * span * 0.01 * Math.max(dt, 0.016);
    for (let i = 0; i < RAIN_STREAKS; i++) {
      const o = i * 6;
      let y = arr[o + 1]! - fall;
      if (y < 0 || arr[o] === 0) {
        const r1 = Math.sin(i * 12.9898 + performance.now() * 0.001) * 43758.5453;
        const r2 = Math.sin(i * 78.233 + performance.now() * 0.0013) * 12543.15;
        arr[o] = t.x + (r1 - Math.floor(r1) - 0.5) * span * 2;
        arr[o + 2] = t.z + (r2 - Math.floor(r2) - 0.5) * span * 2;
        y = span * 0.6 * (0.5 + (r1 - Math.floor(r1)) * 0.5);
      }
      arr[o + 1] = y;
      arr[o + 3] = arr[o]!;
      arr[o + 4] = y + span * 0.02;
      arr[o + 5] = arr[o + 2]!;
    }
    pos.needsUpdate = true;
  }

  /** Headlights at night; trails behind moving vehicles at 120× and above (AD-10). */
  private updateHeadlightsAndTrails(): void {
    const n = this.trails.length;
    if (n === 0) return;
    const t = this.simTime();
    if (this.headlights.visible) {
      const hp: number[] = [];
      for (let i = 0; i < n; i++) {
        if (this.positions[i * 4 + 3] === 0) continue;
        const x = this.positions[i * 4]!;
        const y = this.positions[i * 4 + 1]!;
        const h = this.positions[i * 4 + 2]!;
        hp.push(x + Math.cos(h) * 1.5, 1.2, -(y + Math.sin(h) * 1.5));
      }
      this.headlights.geometry.setAttribute('position', new BufferAttribute(new Float32Array(hp), 3));
    }
    const on = trailsEnabled(this.simSpeed);
    this.trailLines.visible = on;
    if (!on) {
      if (this.lastTrailT >= 0) for (const tr of this.trails) tr.clear();
      this.lastTrailT = -1;
      return;
    }
    if (this.lastTrailT >= 0 && t - this.lastTrailT < 1) return;
    this.lastTrailT = t;
    const seg: number[] = [];
    for (let i = 0; i < n; i++) {
      const tr = this.trails[i]!;
      if (this.positions[i * 4 + 3] === 0) {
        tr.clear();
        continue;
      }
      tr.push(t, this.positions[i * 4]!, this.positions[i * 4 + 1]!);
      const pts = tr.recent(t, TRAIL_SECONDS);
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1]!;
        const b = pts[k]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) > 300) continue;
        seg.push(a.x, 1, -a.y, b.x, 1, -b.y);
      }
    }
    this.trailLines.geometry.setAttribute('position', new BufferAttribute(new Float32Array(seg), 3));
  }

  drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  private updateSun(): void {
    if (!this.curr || !this.origin || !this.view) return;
    const { lat, lon } = localToLatLon({ x: 0, y: 0 }, this.origin);
    const pos = sunPosition(toUtcMs(this.simTime(), this.view.startDate), lat, lon);
    const alt = (Math.max(pos.altitudeDeg, 8) * Math.PI) / 180;
    const az = (pos.azimuthDeg * Math.PI) / 180;
    const t = this.controls.target;
    this.sun.position.set(t.x + Math.sin(az) * Math.cos(alt) * 2500, Math.sin(alt) * 2500, t.z - Math.cos(az) * Math.cos(alt) * 2500);
    this.sun.target.position.copy(t);
    // Day, twilight and night follow the real sun (X-2, M2-6); the toggle can force day or night for viewing.
    const l = lightingFor(pos.altitudeDeg, this.override);
    this.lighting = l;
    this.sun.intensity = Math.max(0.15, l.sun);
    this.hemi.intensity = l.sky + 0.25;
    if (this.streetLights) this.streetLights.visible = l.nightLights;
    this.headlights.visible = l.nightLights;
    this.renderer.setClearColor(l.phase === 'night' ? NIGHT_BACKGROUND : PALETTE.background);
    const d = Math.min(1500, Math.max(150, this.camera.position.distanceTo(t)));
    const cam = this.sun.shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.far = 6000;
    cam.updateProjectionMatrix();
  }

  private animate(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;
    this.interpolate();
    if (this.glide) {
      const k = ease(Math.min(1, (now - this.glide.start) / GLIDE_MS));
      this.controls.target.lerpVectors(this.glide.fromTarget, this.glide.toTarget, k);
      this.camera.position.lerpVectors(this.glide.fromPos, this.glide.toPos, k);
      if (k >= 1) this.glide = null;
    }
    const sel = this.selection;
    const p = sel ? this.positionOf(sel) : null;
    if (sel && p) {
      if (this.following && !this.glide) {
        const desired = new Vector3(p.x, 0, -p.y);
        const delta = desired.sub(this.controls.target).multiplyScalar(this.reducedMotion ? 1 : 1 - Math.exp(-dt * 8));
        this.controls.target.add(delta);
        this.camera.position.add(delta);
      } else if (this.following && this.glide) {
        this.glide.toTarget.set(p.x, 0, -p.y);
      }
      const pulse = this.reducedMotion ? 1 : 1 + 0.15 * Math.sin(now / 220);
      this.ring.visible = true;
      this.ring.position.set(p.x, 0.5, -p.y);
      const scale = Math.max(1, this.camera.position.distanceTo(this.ring.position) / 400) * pulse;
      this.ring.scale.set(scale, 1, scale);
      const s = this.toScreen(p.x, p.y, 4);
      this.selectionLabel.hidden = !s;
      if (s) this.selectionLabel.style.transform = `translate(${s.x}px, ${s.y - 18}px) translate(-50%, -100%)`;
    } else if (sel) {
      this.ring.visible = false;
      this.selectionLabel.hidden = true;
    }
    this.controls.update();
    const far = this.camera.position.distanceTo(this.controls.target);
    this.labels?.update(this.camera, far, this.renderer.domElement.clientHeight, performance.now() / 1000, this.reducedMotion);
    this.updateSun();
    this.updateRain(dt);
    this.updateHeadlightsAndTrails();
    this.renderer.render(this.scene, this.camera);
    const listeners = this.frameListeners;
    this.frameListeners = [];
    for (const cb of listeners) cb();
  }
}

/** Street lights along the main roads (M2-6): warm points every ~45 m, one draw call, shown at night. */
function buildStreetLights(g: RoadGraph): Points {
  const major = new Set(['trunk', 'primary', 'secondary', 'tertiary'].map((c) => HIGHWAY_CLASSES.indexOf(c as (typeof HIGHWAY_CLASSES)[number])));
  const pos: number[] = [];
  for (let e = 0; e < g.edgeCount; e++) {
    const twin = g.edgeTwin[e]!;
    if ((twin >= 0 && twin < e) || !major.has(g.edgeClass[e]!)) continue;
    let carry = 0;
    for (let k = g.shapeStart[e]!; k + 1 < g.shapeStart[e + 1]!; k++) {
      const x0 = g.shapeXY[2 * k]!;
      const y0 = g.shapeXY[2 * k + 1]!;
      const x1 = g.shapeXY[2 * k + 2]!;
      const y1 = g.shapeXY[2 * k + 3]!;
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let d = STREET_LIGHT_SPACING_M - carry; d < len; d += STREET_LIGHT_SPACING_M) {
        const f = d / len;
        pos.push(x0 + (x1 - x0) * f, 7, -(y0 + (y1 - y0) * f));
      }
      carry = (carry + len) % STREET_LIGHT_SPACING_M;
    }
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  const points = new Points(geom, new PointsMaterial({ color: '#ffcf7a', size: 4, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }));
  points.name = 'street-lights';
  points.visible = false;
  return points;
}
