import type { RoadGraph } from './graph';

/**
 * Strongly connected components (iterative Tarjan). Returns each node's component id; ids are assigned in completion
 * order, so they are deterministic for a given graph.
 */
export function stronglyConnected(g: RoadGraph): Int32Array {
  const n = g.nodeCount;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const comp = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  const callStack: { v: number; e: number }[] = [];
  let next = 0;
  let compId = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    callStack.push({ v: root, e: g.firstOut[root]! });
    index[root] = low[root] = next++;
    stack.push(root);
    onStack[root] = 1;
    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1]!;
      const v = frame.v;
      if (frame.e < g.firstOut[v + 1]!) {
        const w = g.edgeTo[frame.e++]!;
        if (index[w] === -1) {
          index[w] = low[w] = next++;
          stack.push(w);
          onStack[w] = 1;
          callStack.push({ v: w, e: g.firstOut[w]! });
        } else if (onStack[w]) {
          low[v] = Math.min(low[v]!, index[w]!);
        }
        continue;
      }
      if (low[v] === index[v]) {
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = 0;
          comp[w] = compId;
        } while (w !== v);
        compId++;
      }
      callStack.pop();
      const parent = callStack[callStack.length - 1];
      if (parent) low[parent.v] = Math.min(low[parent.v]!, low[v]!);
    }
  }
  return comp;
}

/** Membership mask of the largest strongly connected component (lowest component id on ties). */
export function largestComponentMask(g: RoadGraph): Uint8Array {
  const comp = stronglyConnected(g);
  const sizes = new Map<number, number>();
  for (const c of comp) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  let best = -1;
  let bestSize = -1;
  for (const [c, size] of [...sizes].sort((a, b) => a[0] - b[0])) {
    if (size > bestSize) {
      best = c;
      bestSize = size;
    }
  }
  return Uint8Array.from(comp, (c) => (c === best ? 1 : 0));
}
