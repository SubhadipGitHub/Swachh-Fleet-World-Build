import type { IsoDate } from '../config/sources';
import { daysFromCivil, parseCivil } from '../shared/civil';
import { formatIst, istDate } from '../sim/clock';

const WEEKDAYS = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed 14 Oct 2026" and "06:31" for the IST clock (D-2). */
export function formatClock(t: number, start: IsoDate): { date: string; time: string } {
  const date = istDate(t, start);
  const [y, m, d] = parseCivil(date)!;
  const weekday = WEEKDAYS[((daysFromCivil(y, m, d) % 7) + 7) % 7]!;
  return { date: `${weekday} ${d} ${MONTHS[m - 1]!} ${y}`, time: formatIst(t, start).slice(11) };
}

const STATE_LABELS: Readonly<Record<string, string>> = {
  OffShift: 'Off shift',
  Absent: 'Absent today',
  ToBeat: 'Driving to beat',
  Driving: 'On beat',
  Serving: 'Collecting',
  ToTransfer: 'To transfer point',
  Tipping: 'Tipping at transfer point',
  ToDepot: 'Returning to depot',
  BrokenDown: 'Broken down',
  Deviating: 'Off route',
  ToTransferPoint: 'To transfer point',
  Queued: 'Queued at transfer point',
  Loading: 'Loading',
  ToKCDC: 'Hauling to KCDC',
  Weighing: 'On the weighbridge',
  Unloading: 'Unloading',
  ToLandfill: 'Diverted to landfill',
  Idle: 'Idle',
  ToBlackSpot: 'To black spot',
  Clearing: 'Clearing black spot',
  ToDisposal: 'To disposal',
  Waiting: 'Waiting for dispatch',
};

/** M3-10: why a street is on a Dynamic route. */
export const REASON_LABELS: Readonly<Record<string, string>> = {
  beat: 'Usual beat',
  backlog: 'Backlog',
  fairness: 'Fairness (48 h)',
  blackSpotRisk: 'Black-spot risk',
};

/** M3-10: why a street was deferred. */
export const DEFER_LABELS: Readonly<Record<string, string>> = {
  capacity: 'No tipper had the time',
  closed: 'Road closed',
  lowBacklog: 'Low backlog, within the 48 h limit',
};

/** M3-D9: what triggered a re-plan. */
export const CAUSE_LABELS: Readonly<Record<string, string>> = {
  daily: 'Daily plan',
  breakdown: 'Breakdown',
  closure: 'Road closure',
  policy: 'Policy switch',
};

export const stateLabel = (s: string): string => STATE_LABELS[s] ?? s;

export const KIND_LABELS: Readonly<Record<string, string>> = {
  'auto-tipper': 'Auto-tipper',
  compactor: 'Compactor truck',
  crew: 'Clearance crew (tipper lorry + mini excavator)',
  market: 'Market bin',
  commercial: 'Commercial street bin',
  'transfer-point': 'Transfer point container',
  'black-spot': 'Black-spot bin',
};

export const fmt = (n: number, digits = 0): string => n.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
