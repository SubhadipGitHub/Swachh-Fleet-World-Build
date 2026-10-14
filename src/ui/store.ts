import { signal } from '@preact/signals';
import type { RoutingPolicy, WeatherMode } from '../config/scenario';
import type { LightOverride } from '../render/lighting';
import type { Selection } from '../render/scene';
import type { Alert } from '../sim/alerts';
import type { DataSourceRow } from '../sim/provenance-rows';
import type { VehicleExplain, VehiclePlan, VehicleView } from '../sim/world';
import type { FromSim, MapView } from '../workers/protocol';
import type { SearchIndex } from './search';
import type { Theme } from './theme';

export type Dashboard = Extract<FromSim, { type: 'dashboard' }>;
export type TableTab = 'bins' | 'fleet' | 'routes';
export type SheetTab = 'details' | 'tracker' | 'tables' | 'alerts';

/** UI state as signals (AD-11). Only the UI reads these; the scene and host write through `commands`. */
export const store = {
  status: signal<'loading' | 'ready' | 'error'>('loading'),
  error: signal<string | null>(null),
  view: signal<MapView | null>(null),
  simTime: signal(0),
  speed: signal(60),
  paused: signal(false),
  following: signal(false),
  selection: signal<Selection | null>(null),
  vehicleDetail: signal<{ vehicle: VehicleView; plan: VehiclePlan; explain: VehicleExplain | null } | null>(null),
  /** Latest reported bin fill (%) and black-spot sizes (kg), refreshed at 4 Hz. */
  binFill: signal<Float32Array>(new Float32Array(0)),
  spotSize: signal<Float32Array>(new Float32Array(0)),
  hostKind: signal<'worker' | 'inline'>('worker'),
  // M2
  dashboard: signal<Dashboard | null>(null),
  /** Newest first, at most 200 (M2-10). */
  alerts: signal<readonly Alert[]>([]),
  alertsOpen: signal(false),
  dataSourcesOpen: signal(false),
  dataSourceRows: signal<readonly DataSourceRow[]>([]),
  weather: signal<WeatherMode>('clear'),
  lightOverride: signal<LightOverride>('auto'),
  theme: signal<Theme>('dark'),
  tableTab: signal<TableTab>('bins'),
  searchIndex: signal<SearchIndex | null>(null),
  /** X-3: narrow screens use one tabbed bottom sheet. */
  phone: signal(false),
  sheetTab: signal<SheetTab>('tracker'),
  // M3
  /** M3-1: the routing policy as the user last chose it (the worker confirms it in the dashboard message). */
  policy: signal<RoutingPolicy>('static'),
};
