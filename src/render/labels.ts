import { BufferAttribute, BufferGeometry, CanvasTexture, DynamicDrawUsage, Group, LineBasicMaterial, LineSegments, Points, PointsMaterial, SRGBColorSpace, Sprite, SpriteMaterial, Vector3, type PerspectiveCamera } from 'three';
import { wardAt } from '../sim/naming';
import type { MapView } from '../workers/protocol';
import { facilityCentre, facilityColour } from './agents';
import { PALETTE } from './palette';

/** W-8, architecture §9.2 (CR-2): place names as signs floating in the 3D world. */
export type LabelGroup = 'area' | 'ward' | 'facility';

export interface PlaceLabel {
  readonly group: LabelGroup;
  readonly text: string;
  /** Ground anchor in local metres. */
  readonly x: number;
  readonly y: number;
  /** Border colour of the sign. */
  readonly colour: string;
}

/** Bob amplitude as a share of the card height, and its period in real seconds. */
export const FLOAT_AMPLITUDE = 0.12;
export const FLOAT_PERIOD_S = 4;
/** The card's bottom floats this many card heights above the ground. */
export const PIN_RATIO = 1.5;

const AREAS: readonly { readonly text: string; readonly wards: readonly string[] }[] = [
  { text: 'HSR Layout', wards: ['South-72'] },
  { text: 'Koramangala', wards: ['South-28', 'South-29'] },
];

const centre = (pts: readonly (readonly [number, number])[]): { x: number; y: number } => ({
  x: pts.reduce((a, p) => a + p[0], 0) / Math.max(1, pts.length),
  y: pts.reduce((a, p) => a + p[1], 0) / Math.max(1, pts.length),
});

/** CR2-2: area names (where the area buttons fly to), ward names, transfer points and KCDC. */
export function placeLabels(view: Pick<MapView, 'wards' | 'facilities'>): PlaceLabel[] {
  const out: PlaceLabel[] = [];
  for (const a of AREAS) {
    const pts = view.wards.filter((w) => a.wards.includes(w.key)).flatMap((w) => w.rings.flat());
    if (pts.length > 0) out.push({ group: 'area', text: a.text, ...centre(pts), colour: `#${PALETTE.accent.getHexString()}` });
  }
  for (const w of view.wards) out.push({ group: 'ward', text: `${w.key} · ${w.name}`, ...centre(w.rings.flat()), colour: `#${PALETTE.wardLine.getHexString()}` });
  // Transfer points first, then KCDC, in the order the waste travels.
  for (const f of view.facilities.filter((f) => f.kind === 'transfer-point')) {
    const ward = wardAt(view.wards, f.x, f.y);
    out.push({ group: 'facility', text: ward ? `${f.displayId} · ${ward.name}` : f.displayId, ...facilityCentre(f), colour: facilityColour(f.kind) });
  }
  for (const f of view.facilities.filter((f) => f.kind === 'kcdc')) out.push({ group: 'facility', text: 'KCDC Kudlu Gate', ...facilityCentre(f), colour: facilityColour(f.kind) });
  return out;
}

/** CR2-3: camera-to-target distance bands [fade in from, full from, full to, faded out at]. */
const BANDS: Readonly<Record<LabelGroup, readonly [number, number, number, number]>> = {
  area: [3800, 4400, Infinity, Infinity],
  ward: [800, 1000, 3800, 4400],
  facility: [-Infinity, -Infinity, 2400, 2800],
};

export function labelOpacity(group: LabelGroup, cameraDistance: number): number {
  const [a, b, c, d] = BANDS[group];
  if (cameraDistance <= a || cameraDistance >= d) return 0;
  if (cameraDistance < b) return (cameraDistance - a) / (b - a);
  if (cameraDistance > c) return (d - cameraDistance) / (d - c);
  return 1;
}

const BASE_PX: Readonly<Record<LabelGroup, number>> = { area: 30, ward: 22, facility: 18 };
const REF_DISTANCE = 2000;

/** CR2-5: on-screen card height in CSS px; nearer labels are larger, within 0.7–1.4 × the group's base. */
export function labelPixelHeight(group: LabelGroup, distance: number): number {
  const base = BASE_PX[group];
  const k = Math.sqrt(REF_DISTANCE / Math.max(1, distance));
  return base * Math.min(1.4, Math.max(0.7, k));
}

/** Metres that cover `px` CSS pixels at `distance` from a perspective camera with vertical field of view `fovDeg`. */
export function worldHeightForPixels(px: number, distance: number, fovDeg: number, viewportPx: number): number {
  return (px * 2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportPx);
}

/** CR2-5: the gentle bob, in metres; phase-shifted per label and still under reduced motion. */
export function floatOffset(tSec: number, index: number, cardHeight: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return FLOAT_AMPLITUDE * cardHeight * Math.sin(2 * Math.PI * (tSec / FLOAT_PERIOD_S + index * 0.37));
}

// --- Drawing (browser only) ------------------------------------------------------------------------------------

const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TEXTURE_SCALE = 2;
const TEXTURE_FONT_PX: Readonly<Record<LabelGroup, number>> = { area: 30, ward: 24, facility: 22 };
/** Pin and ground-dot colour (light, as the cards' text). */
const PIN_RGB = [0.93, 0.94, 0.92] as const;

/** CR2-4: a rounded graphite card with light text and a border in the label's colour. */
function cardTexture(l: PlaceLabel): { texture: CanvasTexture; aspect: number } {
  const fontPx = TEXTURE_FONT_PX[l.group] * TEXTURE_SCALE;
  const weight = l.group === 'area' ? 700 : 600;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${weight} ${fontPx}px ${FONT}`;
  const padX = fontPx * 0.6;
  const h = Math.ceil(fontPx * 1.75);
  const w = Math.ceil(ctx.measureText(l.text).width + 2 * padX);
  canvas.width = w;
  canvas.height = h;
  const line = 2 * TEXTURE_SCALE;
  const r = h * 0.3;
  ctx.beginPath();
  ctx.roundRect(line / 2, line / 2, w - line, h - line, r);
  ctx.fillStyle = 'rgba(28, 31, 34, 0.88)';
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = l.colour;
  ctx.stroke();
  ctx.font = `${weight} ${fontPx}px ${FONT}`;
  ctx.fillStyle = '#eef0ec';
  ctx.textBaseline = 'middle';
  ctx.fillText(l.text, padX, h / 2 + fontPx * 0.04);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: w / h };
}

interface Item {
  readonly label: PlaceLabel;
  readonly sprite: Sprite;
  readonly aspect: number;
  opacity: number;
  /** Card centre height above the ground (m), for screen lookups. */
  centreHeight: number;
}

/**
 * CR2-6: one sprite per label, one line set for all pins and one point set for the ground dots. Sprites are
 * depth-tested but do not write depth, and they are never picked (picking uses object positions, not raycasts).
 */
export class PlaceLabels {
  readonly group = new Group();
  private readonly items: Item[];
  private readonly pinPos: Float32Array;
  private readonly pinCol: Float32Array;
  private readonly dotCol: Float32Array;
  private readonly pins: BufferGeometry;
  private readonly dots: BufferGeometry;
  private readonly tmp = new Vector3();

  constructor(labels: readonly PlaceLabel[]) {
    this.group.name = 'place-labels';
    this.items = labels.map((label) => {
      const { texture, aspect } = cardTexture(label);
      const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
      sprite.center.set(0.5, 0);
      sprite.renderOrder = 10;
      sprite.visible = false;
      this.group.add(sprite);
      return { label, sprite, aspect, opacity: 0, centreHeight: 0 };
    });
    const n = labels.length;
    this.pinPos = new Float32Array(n * 6);
    this.pinCol = new Float32Array(n * 8);
    this.dotCol = new Float32Array(n * 4);
    const dotPos = new Float32Array(n * 3);
    labels.forEach((l, i) => {
      dotPos.set([l.x, 0.4, -l.y], i * 3);
      this.pinPos.set([l.x, 0, -l.y, l.x, 0, -l.y], i * 6);
    });
    this.pins = new BufferGeometry();
    this.pins.setAttribute('position', new BufferAttribute(this.pinPos, 3).setUsage(DynamicDrawUsage));
    this.pins.setAttribute('color', new BufferAttribute(this.pinCol, 4).setUsage(DynamicDrawUsage));
    this.dots = new BufferGeometry();
    this.dots.setAttribute('position', new BufferAttribute(dotPos, 3));
    this.dots.setAttribute('color', new BufferAttribute(this.dotCol, 4).setUsage(DynamicDrawUsage));
    const pinLines = new LineSegments(this.pins, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    const dotPoints = new Points(this.dots, new PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false }));
    pinLines.frustumCulled = false;
    dotPoints.frustumCulled = false;
    pinLines.renderOrder = 9;
    dotPoints.renderOrder = 9;
    this.group.add(pinLines, dotPoints);
  }

  /** Places, sizes, fades and bobs every label for this frame. */
  update(camera: PerspectiveCamera, targetDistance: number, viewportPx: number, nowSec: number, reducedMotion: boolean): void {
    this.items.forEach((it, i) => {
      const { label, sprite } = it;
      const op = labelOpacity(label.group, targetDistance);
      it.opacity = op;
      sprite.visible = op > 0.01;
      let top = 0;
      if (sprite.visible) {
        const dist = camera.position.distanceTo(this.tmp.set(label.x, 0, -label.y));
        const h = worldHeightForPixels(labelPixelHeight(label.group, dist), dist, camera.fov, viewportPx);
        top = PIN_RATIO * h + floatOffset(nowSec, i, h, reducedMotion);
        sprite.position.set(label.x, top, -label.y);
        sprite.scale.set(h * it.aspect, h, 1);
        sprite.material.opacity = op;
        it.centreHeight = top + h / 2;
      }
      this.pinPos[i * 6 + 4] = top;
      const [r, g, b] = PIN_RGB;
      this.pinCol.set([r, g, b, op * 0.7, r, g, b, op * 0.7], i * 8);
      this.dotCol.set([r, g, b, op * 0.9], i * 4);
    });
    this.pins.attributes.position!.needsUpdate = true;
    this.pins.attributes.color!.needsUpdate = true;
    this.dots.attributes.color!.needsUpdate = true;
  }

  /** Labels at least half faded in, with the card centre height, for the debug hook (CR2-7). */
  shown(): { label: PlaceLabel; centreHeight: number }[] {
    return this.items.filter((it) => it.opacity >= 0.5).map((it) => ({ label: it.label, centreHeight: it.centreHeight }));
  }
}
