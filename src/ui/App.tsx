import type { JSX } from 'preact';
import type { RoutingPolicy, WeatherMode } from '../config/scenario';
import type { AreaId, Selection } from '../render/scene';
import type { Alert } from '../sim/alerts';
import type { VehicleExplain } from '../sim/world';
import { STATE_NAMES } from '../workers/protocol';
import { AlertsList, DataSourcesDialog, KpiCards, SearchBox, Tables, Tag, Tracker, type TagKind } from './Dashboard';
import { CAUSE_LABELS, DEFER_LABELS, KIND_LABELS, REASON_LABELS, fmt, formatClock, stateLabel } from './format';
import type { SearchEntry } from './search';
import { store, type SheetTab } from './store';

export interface Commands {
  readonly setSpeed: (speed: number) => void;
  readonly togglePause: () => void;
  readonly skipToMorning: () => void;
  readonly flyTo: (area: AreaId) => void;
  readonly clearSelection: () => void;
  // M2
  readonly select: (sel: Selection) => void;
  readonly setWeather: (mode: WeatherMode) => void;
  readonly cycleLight: () => void;
  readonly toggleTheme: () => void;
  readonly toggleAlerts: () => void;
  readonly pickAlert: (a: Alert) => void;
  readonly pickSearch: (e: SearchEntry) => void;
  readonly setDataSourcesOpen: (open: boolean) => void;
  // M3
  readonly setPolicy: (policy: RoutingPolicy) => void;
}

const SPEEDS = [30, 60, 120, 240] as const;
const AREAS: readonly { id: AreaId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'hsr', label: 'HSR Layout' },
  { id: 'koramangala', label: 'Koramangala' },
  { id: 'transfer-points', label: 'Transfer points' },
  { id: 'kcdc', label: 'KCDC Kudlu Gate' },
];
const WEATHER: readonly { id: WeatherMode; label: string }[] = [
  { id: 'clear', label: 'Clear' },
  { id: 'monsoon', label: 'Monsoon downpour' },
  { id: 'haze', label: 'Winter haze' },
  { id: 'heatwave', label: 'Heatwave' },
];
const LIGHT_LABEL = { auto: 'Auto', day: 'Day', night: 'Night' } as const;
const POLICIES: readonly { id: RoutingPolicy; label: string }[] = [
  { id: 'static', label: 'Static' },
  { id: 'dynamic', label: 'Dynamic' },
];
/** Planned streets listed in "Why this route" before "and n more". */
const WHY_ROWS = 12;

function Logo(): JSX.Element {
  // An original mark (no government or programme emblems, N-7).
  return (
    <svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="8" fill="var(--accent)" />
      <path d="M9 21h11l3-5h-6l-2-5H9z" fill="var(--bg)" />
      <circle cx="12" cy="23" r="2" fill="var(--bg)" />
      <circle cx="20" cy="23" r="2" fill="var(--bg)" />
    </svg>
  );
}

function TopBar({ commands }: { commands: Commands }): JSX.Element {
  const view = store.view.value;
  const clock = view ? formatClock(Math.floor(store.simTime.value), view.startDate) : null;
  const following = store.following.value;
  const alerts = store.alerts.value.length;
  const light = store.lightOverride.value;
  const theme = store.theme.value;
  return (
    <header class="topbar panel">
      <div class="brand">
        <Logo />
        <div>
          <div class="brand-name">KasaFlow Bengaluru</div>
          <div class="brand-sub">Waste collection · Bengaluru South</div>
        </div>
      </div>
      <SearchBox onPick={commands.pickSearch} />
      <nav class="areas" aria-label="Areas">
        {AREAS.map((a) => (
          <button
            type="button"
            key={a.id}
            onClick={() => {
              commands.flyTo(a.id);
            }}
          >
            {a.label}
          </button>
        ))}
      </nav>
      <div class="time-controls" role="group" aria-label="Simulation speed">
        <button type="button" class="icon" aria-pressed={store.paused.value} aria-label={store.paused.value ? 'Play' : 'Pause'} onClick={commands.togglePause}>
          {store.paused.value ? '▶' : '❚❚'}
        </button>
        {SPEEDS.map((s) => (
          <button
            type="button"
            key={s}
            aria-pressed={store.speed.value === s}
            onClick={() => {
              commands.setSpeed(s);
            }}
          >
            {s}×
          </button>
        ))}
        <button type="button" title="Skip to 05:45 tomorrow" onClick={commands.skipToMorning}>
          Next morning
        </button>
        {following && store.speed.value > 30 ? <span class="badge">Follow · 30×</span> : null}
      </div>
      <select
        class="weather"
        aria-label="Weather"
        value={store.weather.value}
        onChange={(e) => {
          commands.setWeather(e.currentTarget.value as WeatherMode);
        }}
      >
        {WEATHER.map((w) => (
          <option key={w.id} value={w.id}>
            {w.label}
          </option>
        ))}
      </select>
      {clock ? (
        <div class="clock" aria-live="off">
          <div class="clock-time">{clock.time} IST</div>
          <div class="clock-date">{clock.date}</div>
        </div>
      ) : null}
      <div class="policy-switch" role="radiogroup" aria-label="Routing policy" title="Routing policy (M3): Static is today's fixed beats; Dynamic re-plans from sensors and the roster">
        {POLICIES.map((p) => (
          <label key={p.id} class={store.policy.value === p.id ? 'on' : ''}>
            <input
              type="radio"
              name="routing-policy"
              value={p.id}
              checked={store.policy.value === p.id}
              onChange={() => {
                commands.setPolicy(p.id);
              }}
            />
            {p.label}
          </label>
        ))}
      </div>
      <div class="toolbar">
        <button type="button" class="alerts-button" aria-label={`Alerts (${alerts})`} aria-expanded={store.alertsOpen.value} onClick={commands.toggleAlerts}>
          Alerts {alerts > 0 ? <span class="count">{alerts}</span> : null}
        </button>
        <button
          type="button"
          onClick={() => {
            commands.setDataSourcesOpen(true);
          }}
        >
          Data sources
        </button>
        <button type="button" class="icon" aria-label={`Day/night: ${LIGHT_LABEL[light]}`} title={`Lighting: ${LIGHT_LABEL[light]}`} onClick={commands.cycleLight}>
          {light === 'night' ? '☾' : light === 'day' ? '☀' : '◐'}
        </button>
        <button type="button" class="icon" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={commands.toggleTheme}>
          {theme === 'dark' ? '☼' : '☾'}
        </button>
        <span class="chip" title="No sign-in: everyone views the same simulation">
          Viewer
        </span>
      </div>
    </header>
  );
}

function Row({ label, value, tag }: { label: string; value: string; tag: TagKind }): JSX.Element {
  return (
    <div class="row">
      <dt>{label}</dt>
      <dd>
        {value} <Tag kind={tag} />
      </dd>
    </div>
  );
}

/** The selected object's display name, for the tracker heading. */
function selectionName(sel: Selection | null): string | null {
  const view = store.view.value;
  if (!sel || !view) return null;
  if (sel.kind === 'vehicle') return view.vehicles[sel.index]?.displayId ?? null;
  if (sel.kind === 'bin') return `Bin ${view.bins[sel.index]?.displayId ?? ''}`;
  if (sel.kind === 'facility') return view.facilities[sel.index]?.displayId ?? null;
  return view.blackSpots[sel.index]?.displayId ?? null;
}

function DetailPanel({ commands }: { commands: Commands }): JSX.Element | null {
  const sel = store.selection.value;
  const view = store.view.value;
  if (!sel || !view) return null;
  let title: string;
  let subtitle: string;
  let rows: JSX.Element[] = [];
  let why: JSX.Element | null = null;
  if (sel.kind === 'vehicle') {
    const meta = view.vehicles[sel.index]!;
    title = meta.displayId;
    subtitle = KIND_LABELS[meta.kind] ?? meta.kind;
    const d = store.vehicleDetail.value;
    if (d && d.vehicle.id === meta.id) {
      const v = d.vehicle;
      rows = [
        <Row key="s" label="Status" value={stateLabel(v.state)} tag="Simulated" />,
        <Row key="l" label="Load" value={`${fmt(v.loadKg)} / ${fmt(v.payloadKg)} kg`} tag="Simulated" />,
        <Row key="v" label="Speed" value={`${fmt(v.speedMps * 3.6)} km/h`} tag="Simulated" />,
        <Row key="k" label="Distance today" value={`${fmt(v.kmToday, 1)} km`} tag="Simulated" />,
        <Row key="f" label="Fuel today" value={`${fmt(v.fuelLitresToday, 1)} L`} tag="Simulated" />,
        <Row key="st" label="Stops served" value={fmt(v.servedToday)} tag="Simulated" />,
        <Row key="sk" label="Stops skipped" value={fmt(v.skippedToday)} tag="Simulated" />,
      ];
      if (d.explain) why = <WhyThisRoute explain={d.explain} />;
    }
  } else if (sel.kind === 'bin') {
    const b = view.bins[sel.index]!;
    const reported = store.binFill.value[sel.index * 2] ?? -1;
    title = `Bin ${b.displayId}`;
    subtitle = KIND_LABELS[b.kind] ?? b.kind;
    rows = [
      <Row key="f" label="Sensor reading" value={reported < 0 ? 'No reading' : `${fmt(reported)}%`} tag="Simulated" />,
      <Row key="c" label="Capacity" value={`${fmt(b.capacityKg)} kg`} tag="Assumed" />,
    ];
  } else if (sel.kind === 'blackSpot') {
    const s = view.blackSpots[sel.index]!;
    const size = store.spotSize.value[sel.index] ?? 0;
    title = s.displayId;
    subtitle = 'Black spot (garbage vulnerable point)';
    rows = [<Row key="z" label="Dumped waste" value={`${fmt(size)} kg`} tag="Simulated" />];
  } else {
    const f = view.facilities[sel.index]!;
    title = f.displayId;
    subtitle = f.name;
    rows = [<Row key="loc" label="Location" value={f.location === 'real' ? 'OpenStreetMap' : 'Location assumed'} tag={f.location === 'real' ? 'Real' : 'Assumed'} />];
  }
  return (
    <aside class="detail panel" aria-label="Details">
      <div class="detail-head">
        <div>
          <h2>{title}</h2>
          <div class="detail-sub">{subtitle}</div>
        </div>
        <button type="button" class="icon" aria-label="Close details" onClick={commands.clearSelection}>
          ✕
        </button>
      </div>
      <dl>{rows}</dl>
      {why}
      <p class="fine">Live values are simulated, calibrated to published Bengaluru figures.</p>
    </aside>
  );
}

/** M3-10: why each street is on a tipper's route, what was deferred and why, and today's re-plans. */
function WhyThisRoute({ explain }: { explain: VehicleExplain }): JSX.Element {
  const start = store.view.value?.startDate;
  const time = (t: number): string => (start ? formatClock(t, start).time : '');
  return (
    <section class="why" aria-label="Why this route">
      <h3>Why this route</h3>
      <p class="dim small">{explain.policy === 'dynamic' ? 'Dynamic: planned from sensors, the GPS service log and today’s roster.' : 'Static: the fixed daily beat.'}</p>
      <ul>
        {explain.planned.slice(0, WHY_ROWS).map((p) => (
          <li key={p.segmentId}>
            <span class="why-reason">{REASON_LABELS[p.reason] ?? p.reason}</span> · street {p.segmentId} · ~{fmt(p.predictedKg)} kg · {fmt(p.hoursSinceServed)} h since served
            {p.confidence === 'low' ? ' · low confidence' : ''}
          </li>
        ))}
      </ul>
      {explain.planned.length > WHY_ROWS ? <p class="dim small">and {fmt(explain.planned.length - WHY_ROWS)} more streets</p> : null}
      <h4>Deferred ({fmt(explain.deferred.length)})</h4>
      {explain.deferred.length > 0 ? (
        <ul>
          {explain.deferred.slice(0, WHY_ROWS).map((d) => (
            <li key={d.segmentId}>
              street {d.segmentId} · {DEFER_LABELS[d.reason] ?? d.reason}
              {d.mustServe ? ' · at risk of 48 h' : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {explain.replans.length > 0 ? (
        <>
          <h4>Re-plans</h4>
          <ul>
            {explain.replans.map((r) => (
              <li key={`${r.t}-${r.cause}`}>
                {time(r.t)} · {CAUSE_LABELS[r.cause] ?? r.cause}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Footer(): JSX.Element {
  return (
    <footer class="footer">
      <p class="disclaimer">Independent simulation using public data. Not an official GBA or BSWML system. Results are model estimates.</p>
      <p class="attribution">
        Map data{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>{' '}
        (ODbL) · Wards: GBA 2025 via OpenCity
      </p>
    </footer>
  );
}

const SHEET_TABS: readonly { id: SheetTab; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'tracker', label: 'Tracker' },
  { id: 'tables', label: 'Tables' },
  { id: 'alerts', label: 'Alerts' },
];

/** X-3, M2-14: on phones the panels share one tabbed bottom sheet. */
function PhoneSheet({ commands }: { commands: Commands }): JSX.Element {
  const tab = store.sheetTab.value;
  return (
    <section class="sheet panel">
      <div role="tablist" aria-label="Panel" class="sheet-tabs">
        {SHEET_TABS.map((t) => (
          <button
            type="button"
            role="tab"
            key={t.id}
            aria-selected={tab === t.id}
            onClick={() => {
              store.sheetTab.value = t.id;
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div class="sheet-body">
        {tab === 'details' ? (store.selection.value ? <DetailPanel commands={commands} /> : <p class="dim">Tap a vehicle, bin or facility.</p>) : null}
        {tab === 'tracker' ? <Tracker subject={selectionName(store.selection.value)} /> : null}
        {tab === 'tables' ? <Tables onSelect={commands.select} /> : null}
        {tab === 'alerts' ? <AlertsList onPick={commands.pickAlert} /> : null}
      </div>
    </section>
  );
}

export function App({ commands, webgl }: { commands: Commands; webgl: boolean }): JSX.Element {
  if (!webgl) {
    return (
      <>
        <div class="fatal" role="alert">
          <h1>WebGL 2 is required</h1>
          <p>KasaFlow Bengaluru draws its 3D world with WebGL 2, which this browser or device does not provide. Try a recent Chrome, Edge, Firefox or Safari.</p>
        </div>
        <Footer />
      </>
    );
  }
  const status = store.status.value;
  const phone = store.phone.value;
  return (
    <>
      <TopBar commands={commands} />
      {phone ? (
        <>
          <KpiCards />
          <PhoneSheet commands={commands} />
        </>
      ) : (
        <>
          <div class="side">
            <KpiCards />
            <Tracker subject={selectionName(store.selection.value)} />
          </div>
          <DetailPanel commands={commands} />
          <Tables onSelect={commands.select} />
          {store.alertsOpen.value ? (
            <div class="alerts-dropdown">
              <AlertsList onPick={commands.pickAlert} />
            </div>
          ) : null}
        </>
      )}
      {store.dataSourcesOpen.value ? (
        <DataSourcesDialog
          onClose={() => {
            commands.setDataSourcesOpen(false);
          }}
        />
      ) : null}
      {status === 'loading' ? (
        <div class="loading" role="status">
          Building HSR Layout, Koramangala and Agara from OpenStreetMap…
        </div>
      ) : null}
      {status === 'error' ? (
        <div class="fatal" role="alert">
          <h1>Something went wrong</h1>
          <p>{store.error.value}</p>
        </div>
      ) : null}
      <Footer />
    </>
  );
}

/** The state code in a frame to its label (used by labels outside Preact). */
export const stateFromCode = (code: number): string => stateLabel(STATE_NAMES[code] ?? '');
