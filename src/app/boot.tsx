import { render } from 'preact';
import { getCalibration } from '../config/calibration';
import { deriveClusterScale } from '../config/derive';
import type { RoutingPolicy, WeatherMode } from '../config/scenario';
import { decodeSnapshot, type DecodedSnapshot } from '../geo/snapshot';
import type { LightOverride } from '../render/lighting';
import { WorldScene, type AreaId, type Selection } from '../render/scene';
import { buildGraph } from '../routing/graph';
import { buildSpeedModel } from '../routing/travel-time';
import type { Alert } from '../sim/alerts';
import { dataSourceRows } from '../sim/provenance-rows';
import { App, type Commands } from '../ui/App';
import { fmt } from '../ui/format';
import { buildSearchIndex, type SearchEntry } from '../ui/search';
import { store } from '../ui/store';
import { loadTheme, saveTheme, type Theme, type ThemeStorage } from '../ui/theme';
import { createSimHost, type SimHost } from '../workers/host';
import type { FromSim, MapView, TrackerSelection } from '../workers/protocol';
import type { DebugApi } from './debug-api';
import { loadSnapshotFiles } from './snapshot-data';
import { hasWebGL2 } from './webgl-check';

const SEED = 20_261_014;
const START_AT_SEC = 5 * 3600 + 45 * 60;
const FOLLOW_SPEED_CAP = 30;
const CLICK_SLOP_PX = 5;
const MAX_ALERTS = 200;
const PHONE_QUERY = '(max-width: 720px)';

function displayIdOf(view: MapView, sel: Selection): string {
  switch (sel.kind) {
    case 'vehicle':
      return view.vehicles[sel.index]!.displayId;
    case 'bin':
      return view.bins[sel.index]!.displayId;
    case 'blackSpot':
      return view.blackSpots[sel.index]!.displayId;
    case 'facility':
      return view.facilities[sel.index]!.displayId;
  }
}

function selectionById(view: MapView, id: string): Selection | null {
  let i = view.vehicles.findIndex((v) => v.displayId === id);
  if (i >= 0) return { kind: 'vehicle', index: i };
  i = view.bins.findIndex((b) => b.displayId === id);
  if (i >= 0) return { kind: 'bin', index: i };
  i = view.blackSpots.findIndex((b) => b.displayId === id);
  if (i >= 0) return { kind: 'blackSpot', index: i };
  i = view.facilities.findIndex((f) => f.displayId === id);
  return i >= 0 ? { kind: 'facility', index: i } : null;
}

/** What the process tracker should follow for a selection (D-5). */
function trackerTarget(view: MapView, sel: Selection | null): TrackerSelection | null {
  if (!sel) return null;
  if (sel.kind === 'bin') return { kind: 'bin', id: view.bins[sel.index]!.id };
  if (sel.kind === 'vehicle') return { kind: 'vehicle', id: view.vehicles[sel.index]!.id };
  if (sel.kind === 'facility' && view.facilities[sel.index]!.kind === 'transfer-point') return { kind: 'transferPoint', id: view.facilities[sel.index]!.id };
  return null;
}

/** Search entries (M2-11): vehicles, bins, black spots, facilities, named streets and wards. */
function searchEntries(view: MapView, snapshot: DecodedSnapshot): { entries: SearchEntry[]; points: { x: number; y: number; distance: number }[] } {
  // Equal-rank results keep index order, so the few wards and facilities go first; otherwise a query like "HSR"
  // fills the result list with the many AT-HSR-… vehicles and bins.
  const entries: SearchEntry[] = [];
  const points: { x: number; y: number; distance: number }[] = [];
  for (const w of view.wards) {
    const pts = w.rings.flat();
    entries.push({ kind: 'ward', label: `${w.key} ${w.name}`, keywords: [w.key.split('-')[1]!, w.name], ref: points.length });
    points.push({ x: pts.reduce((a, p) => a + p[0], 0) / pts.length, y: pts.reduce((a, p) => a + p[1], 0) / pts.length, distance: 2400 });
  }
  view.facilities.forEach((f, i) => entries.push({ kind: 'facility', label: f.displayId, keywords: [f.name], ref: i }));
  view.vehicles.forEach((v, i) => entries.push({ kind: 'vehicle', label: v.displayId, keywords: [v.kind], ref: i }));
  view.blackSpots.forEach((b, i) => entries.push({ kind: 'blackSpot', label: b.displayId, keywords: ['black spot'], ref: i }));
  view.bins.forEach((b, i) => entries.push({ kind: 'bin', label: b.displayId, keywords: [b.kind], ref: i }));
  const nodes = new Map(snapshot.roads.nodes.map((n) => [n.id, n]));
  const streets = new Map<string, { x: number; y: number; n: number }>();
  for (const w of snapshot.roads.ways) {
    if (!w.name) continue;
    const mid = nodes.get(w.nodes[Math.floor(w.nodes.length / 2)]!);
    if (!mid || streets.has(w.name)) continue;
    streets.set(w.name, { x: mid.x, y: mid.y, n: w.nodes.length });
  }
  for (const [name, p] of [...streets].sort((a, b) => a[0].localeCompare(b[0]))) {
    entries.push({ kind: 'street', label: name, ref: points.length });
    points.push({ x: p.x, y: p.y, distance: 380 });
  }
  return { entries, points };
}

function safeStorage(): ThemeStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function boot(root: HTMLElement): void {
  const webgl = hasWebGL2();
  const stage = document.createElement('div');
  stage.className = 'stage';
  stage.dataset.weather = 'clear';
  root.appendChild(stage);
  const uiRoot = document.createElement('div');
  uiRoot.className = 'ui';
  root.appendChild(uiRoot);

  // X-4: theme remembered per browser; a storage failure is harmless.
  const storage = safeStorage();
  const applyTheme = (t: Theme): void => {
    store.theme.value = t;
    document.documentElement.dataset.theme = t;
  };
  applyTheme(loadTheme(storage));

  // X-3: phone layout.
  const phoneQuery = matchMedia(PHONE_QUERY);
  store.phone.value = phoneQuery.matches;
  phoneQuery.addEventListener('change', (e) => {
    store.phone.value = e.matches;
  });

  let scene: WorldScene | null = null;
  let host: SimHost | null = null;
  let searchPoints: { x: number; y: number; distance: number }[] = [];
  // A weather change the worker has not confirmed yet; dashboards already in flight still carry the old mode.
  let pendingWeather: WeatherMode | null = null;
  // M3-1: likewise for the routing policy.
  let pendingPolicy: RoutingPolicy | null = null;
  const effectiveSpeed = (): number => (store.following.value ? Math.min(store.speed.value, FOLLOW_SPEED_CAP) : store.speed.value);
  const applySpeed = (): void => {
    host?.send({ type: 'setSpeed', speed: effectiveSpeed() });
    scene?.setSimSpeed(store.paused.value ? 0 : effectiveSpeed());
  };
  const labelFor = (sel: Selection): string => {
    const view = store.view.value!;
    const id = displayIdOf(view, sel);
    if (sel.kind === 'bin') {
      const r = store.binFill.value[sel.index * 2] ?? -1;
      return r < 0 ? `Bin ${id}` : `Bin ${id} · ${fmt(r)}%`;
    }
    return id;
  };
  const select = (sel: Selection | null): void => {
    const view = store.view.value;
    store.selection.value = sel;
    store.vehicleDetail.value = null;
    store.following.value = sel?.kind === 'vehicle';
    if (sel && store.phone.value) store.sheetTab.value = 'details';
    scene?.select(sel);
    if (sel) scene?.setLabel(labelFor(sel));
    host?.send({ type: 'select', vehicleId: sel?.kind === 'vehicle' && view ? view.vehicles[sel.index]!.id : null });
    if (view) host?.send({ type: 'selectObject', target: trackerTarget(view, sel) });
    applySpeed();
  };

  const commands: Commands = {
    setSpeed: (s) => {
      store.speed.value = s;
      store.paused.value = false;
      host?.send({ type: 'setPaused', paused: false });
      applySpeed();
    },
    togglePause: () => {
      store.paused.value = !store.paused.value;
      host?.send({ type: 'setPaused', paused: store.paused.value });
      applySpeed();
    },
    skipToMorning: () => {
      host?.send({ type: 'skipToMorning', reqId: 0 });
    },
    flyTo: (area: AreaId) => {
      select(null);
      scene?.flyToArea(area);
    },
    clearSelection: () => {
      select(null);
    },
    select: (sel) => {
      select(sel);
    },
    setWeather: (mode: WeatherMode) => {
      pendingWeather = mode;
      store.weather.value = mode;
      stage.dataset.weather = mode;
      scene?.setWeather(mode);
      host?.send({ type: 'setWeather', weather: mode });
    },
    cycleLight: () => {
      const next: LightOverride = store.lightOverride.value === 'auto' ? 'day' : store.lightOverride.value === 'day' ? 'night' : 'auto';
      store.lightOverride.value = next;
      scene?.setLightOverride(next);
    },
    toggleTheme: () => {
      const next: Theme = store.theme.value === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      saveTheme(storage, next);
    },
    toggleAlerts: () => {
      store.alertsOpen.value = !store.alertsOpen.value;
    },
    pickAlert: (a: Alert) => {
      const view = store.view.value;
      if (!view) return;
      store.alertsOpen.value = false;
      const t = a.target;
      if (t.type === 'vehicle') select({ kind: 'vehicle', index: t.id });
      else if (t.type === 'bin') select({ kind: 'bin', index: t.id });
      else if (t.type === 'blackSpot') select({ kind: 'blackSpot', index: t.id });
      else if (t.type === 'facility') select({ kind: 'facility', index: view.facilities.findIndex((f) => f.kind === 'kcdc') });
      else if (t.type === 'system') select(null);
      else {
        const spot = view.floodSpots.find((s) => s.id === t.id);
        select(null);
        if (spot) scene?.glideTo(spot.x, spot.y, 420);
      }
    },
    pickSearch: (e: SearchEntry) => {
      if (e.kind === 'street' || e.kind === 'ward') {
        const p = searchPoints[e.ref];
        select(null);
        if (p) scene?.glideTo(p.x, p.y, p.distance);
        return;
      }
      select({ kind: e.kind, index: e.ref });
    },
    setDataSourcesOpen: (open) => {
      store.dataSourcesOpen.value = open;
    },
    setPolicy: (policy: RoutingPolicy) => {
      pendingPolicy = policy;
      store.policy.value = policy;
      host?.send({ type: 'setPolicy', policy });
    },
  };

  render(<App commands={commands} webgl={webgl} />, uiRoot);
  if (!webgl) return;

  // Panels sit just below the top bar, which wraps to more rows on narrower screens.
  const topbar = uiRoot.querySelector('.topbar');
  if (topbar) {
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--top', `${Math.ceil(topbar.getBoundingClientRect().bottom) + 8}px`);
    }).observe(topbar);
  }

  try {
    const files = loadSnapshotFiles();
    const snapshot = decodeSnapshot(files);
    const graph = buildGraph(snapshot.roads);
    const cal = getCalibration();
    store.dataSourceRows.value = dataSourceRows(cal, deriveClusterScale(cal), snapshot.manifest);
    const speedModel = buildSpeedModel({ freeFlowRefKmh: cal.freeFlowRefSpeedKmh.value, morningPeakKmh: cal.morningPeakSpeedKmh.value, eveningPeakKmh: cal.eveningPeakSpeedKmh.value });
    const sc = new WorldScene(stage);
    scene = sc;
    const h = createSimHost();
    host = h;
    let rendered = false;
    const pending = new Map<number, () => void>();
    let nextReq = 1;

    h.onMessage((msg: FromSim) => {
      store.hostKind.value = h.kind();
      switch (msg.type) {
        case 'ready': {
          store.view.value = msg.view;
          sc.setMap(snapshot, graph, msg.view, speedModel);
          const s = searchEntries(msg.view, snapshot);
          searchPoints = s.points;
          store.searchIndex.value = buildSearchIndex(s.entries);
          return;
        }
        case 'frame': {
          sc.onFrame(msg);
          store.binFill.value = msg.bins;
          store.spotSize.value = msg.spots;
          if (!rendered || msg.reqId !== null) {
            const reqId = msg.reqId;
            sc.afterNextRender(() => {
              if (!rendered) {
                rendered = true;
                store.status.value = 'ready';
              }
              if (reqId !== null) {
                pending.get(reqId)?.();
                pending.delete(reqId);
              }
            });
          }
          return;
        }
        case 'dashboard':
          store.dashboard.value = msg;
          if (msg.alerts.length > 0) store.alerts.value = [...[...msg.alerts].reverse(), ...store.alerts.value].slice(0, MAX_ALERTS);
          if (msg.policy === pendingPolicy) pendingPolicy = null;
          if (pendingPolicy === null) store.policy.value = msg.policy;
          if (msg.weather === pendingWeather) pendingWeather = null;
          if (pendingWeather === null && msg.weather !== store.weather.value) {
            store.weather.value = msg.weather;
            stage.dataset.weather = msg.weather;
            sc.setWeather(msg.weather);
          }
          return;
        case 'detail':
          store.vehicleDetail.value = { vehicle: msg.vehicle, plan: msg.plan, explain: msg.explain };
          sc.setPlan(msg.plan);
          return;
        case 'error':
          console.error(`[sim] ${msg.message}`);
          if (!rendered) {
            store.status.value = 'error';
            store.error.value = msg.message;
          }
          return;
      }
    });
    h.send({ type: 'init', files, seed: SEED, startDate: snapshot.manifest.fetchedAt, startAtSec: START_AT_SEC });
    applySpeed();

    setInterval(() => {
      store.simTime.value = sc.simTime();
      const sel = store.selection.value;
      if (sel && store.view.value) sc.setLabel(labelFor(sel));
    }, 250);

    // Click to select (I-2), Esc or empty ground to clear (I-7). A drag is a pan, not a click.
    const canvas = sc.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX || e.button !== 0) return;
      down = null;
      const rect = canvas.getBoundingClientRect();
      select(sc.pick(e.clientX - rect.left, e.clientY - rect.top));
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (store.dataSourcesOpen.value) store.dataSourcesOpen.value = false;
      else if (store.alertsOpen.value) store.alertsOpen.value = false;
      else select(null);
    });

    if (new URLSearchParams(location.search).get('debug') === '1') {
      const onScreenVehicles = (): string[] => {
        const view = store.view.value;
        if (!view) return [];
        const rect = canvas.getBoundingClientRect();
        const screens = view.vehicles.map((_, i) => {
          const p = sc.positionOf({ kind: 'vehicle', index: i });
          return p ? sc.toScreen(p.x, p.y, 1) : null;
        });
        // Only vehicles a click at their position would select, most isolated first, so a test tap is unambiguous
        // even where vehicles bunch up on a small screen.
        const clearance = (i: number): number => {
          const s = screens[i]!;
          let d = Infinity;
          screens.forEach((o, j) => {
            if (o && j !== i) d = Math.min(d, Math.hypot(o.x - s.x, o.y - s.y));
          });
          return d;
        };
        return view.vehicles
          .map((v, i) => ({ id: v.displayId, i }))
          .filter(({ i }) => {
            const s = screens[i];
            if (!s || document.elementFromPoint(rect.left + s.x, rect.top + s.y) !== canvas) return false;
            const hit = sc.pick(s.x, s.y);
            return hit?.kind === 'vehicle' && hit.index === i;
          })
          .map((v) => ({ ...v, clear: clearance(v.i) }))
          .sort((a, b) => b.clear - a.clear || a.i - b.i)
          .map((v) => v.id);
      };
      const api: DebugApi = {
        get ready() {
          return rendered;
        },
        drawCalls: () => sc.drawCalls(),
        skipTo: (hhmm) =>
          new Promise<void>((resolve, reject) => {
            const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
            if (!m) {
              reject(new Error(`Bad time ${hhmm}`));
              return;
            }
            const reqId = nextReq++;
            pending.set(reqId, resolve);
            h.send({ type: 'skipTo', secondOfDay: Number(m[1]) * 3600 + Number(m[2]) * 60, reqId });
          }),
        vehicleIds: onScreenVehicles,
        screenPositionOf: (id) => {
          const view = store.view.value;
          const sel = view ? selectionById(view, id) : null;
          const p = sel ? sc.positionOf(sel) : null;
          return p ? sc.toScreen(p.x, p.y, sel?.kind === 'facility' ? 3 : 1) : null;
        },
        emptyGroundPoint: () => sc.emptyGroundPoint(),
        selectedId: () => {
          const view = store.view.value;
          const sel = store.selection.value;
          return view && sel ? displayIdOf(view, sel) : null;
        },
        lighting: () => sc.lightingState(),
        weather: () => store.weather.value,
        labels: () => sc.shownLabels(),
      };
      window.__kasaflow = api;
    }
  } catch (e) {
    store.status.value = 'error';
    store.error.value = e instanceof Error ? e.message : String(e);
  }
}
