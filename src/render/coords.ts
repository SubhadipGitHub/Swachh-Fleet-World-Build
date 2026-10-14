export interface ThreeXYZ {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Local metres (x east, y north) plus height → Three.js world (x, height, −y) with y up (AD-4). */
export function toThree(x: number, y: number, height = 0): ThreeXYZ {
  return { x, y: height, z: -y };
}

/** The inverse of toThree, dropping the height. */
export function fromThree(p: ThreeXYZ): { readonly x: number; readonly y: number } {
  return { x: p.x, y: -p.z };
}
