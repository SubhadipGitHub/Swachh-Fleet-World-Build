// The live simulation in a Web Worker (architecture AD-8). Bundled inline into the single file as a blob worker.
import { SimEngine } from './engine';
import type { FromSim, FromSolver, SolverConnect, ToSim } from './protocol';

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToSim | SolverConnect>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const engine = new SimEngine();

function post(messages: readonly FromSim[]): void {
  for (const m of messages) {
    if (m.type === 'frame') scope.postMessage(m, [m.vehicles.buffer, m.bins.buffer, m.spots.buffer]);
    else scope.postMessage(m);
  }
}

scope.onmessage = (e) => {
  const msg = e.data;
  // M3-D9: the main thread hands over the solver channel, or says the solver worker is gone.
  if (msg.type === 'connect') {
    const port = msg.port;
    port.onmessage = (m: MessageEvent<FromSolver>) => {
      engine.onSolver(m.data);
    };
    engine.connectSolver((solve) => {
      port.postMessage(solve);
    });
    return;
  }
  if (msg.type === 'lost') {
    engine.connectSolver(null);
    return;
  }
  post(engine.handle(msg));
};

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  post(engine.tick((now - last) / 1000));
  last = now;
}, 33);
