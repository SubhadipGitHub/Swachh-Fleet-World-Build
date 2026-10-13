import type { HighwayClass, RoadNetworkInput, RoadWay } from '../../src/geo/snapshot';

export interface GridOptions {
  readonly highway?: HighwayClass;
  /** Return 'yes' or '-1' to make a block one-way. Called with the way's index in creation order. */
  readonly oneway?: (wayIndex: number) => RoadWay['oneway'];
  readonly lanes?: number;
}

/** OSM-style node id of grid cell (col, row): 1 + row × cols + col. */
export function gridNodeId(cols: number, col: number, row: number): number {
  return 1 + row * cols + col;
}

/**
 * A cols × rows street grid in local metres, every block a separate 2-node way (so every grid node is a graph node).
 * Horizontal ways come first (row by row), then vertical ways (column by column). Way ids start at 1000.
 */
export function gridNetwork(cols: number, rows: number, spacingM: number, options: GridOptions = {}): RoadNetworkInput {
  const nodes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) nodes.push({ id: gridNodeId(cols, c, r), x: c * spacingM, y: r * spacingM });
  }
  const ways: RoadWay[] = [];
  const add = (a: number, b: number): void => {
    const i = ways.length;
    ways.push({
      id: 1000 + i,
      nodes: [a, b],
      highway: options.highway ?? 'residential',
      oneway: options.oneway?.(i) ?? 'no',
      ...(options.lanes !== undefined ? { lanes: options.lanes } : {}),
    });
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c + 1 < cols; c++) add(gridNodeId(cols, c, r), gridNodeId(cols, c + 1, r));
  for (let c = 0; c < cols; c++) for (let r = 0; r + 1 < rows; r++) add(gridNodeId(cols, c, r), gridNodeId(cols, c, r + 1));
  return { nodes, ways };
}
