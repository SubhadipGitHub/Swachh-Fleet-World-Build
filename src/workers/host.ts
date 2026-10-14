import SimWorker from './sim.worker?worker&inline';
import SolverWorker from './solver.worker?worker&inline';
import { SimEngine } from './engine';
import type { FromSim, SolverConnect, ToSim } from './protocol';

/** One interface over the worker and the inline fallback (AD-8, risk R-6). */
export interface SimHost {
  readonly kind: () => 'worker' | 'inline';
  send(msg: ToSim): void;
  onMessage(cb: (msg: FromSim) => void): void;
  dispose(): void;
}

interface Impl {
  send(msg: ToSim): void;
  dispose(): void;
}

/**
 * M3-D9: the Dynamic planner's own worker, joined to the sim worker by a MessageChannel. Optional: if it cannot start
 * or fails, the sim worker is told and plans inline (correct, but that worker pauses while it solves).
 */
function connectSolver(sim: Worker): Worker | null {
  let solver: Worker;
  try {
    solver = new SolverWorker();
  } catch {
    return null;
  }
  const channel = new MessageChannel();
  solver.onerror = (e) => {
    e.preventDefault();
    sim.postMessage({ type: 'lost' } satisfies SolverConnect);
    solver.terminate();
  };
  solver.postMessage({ type: 'connect', port: channel.port2 } satisfies SolverConnect, [channel.port2]);
  sim.postMessage({ type: 'connect', port: channel.port1 } satisfies SolverConnect, [channel.port1]);
  return solver;
}

function workerImpl(deliver: (msg: FromSim) => void, onFail: () => void): Impl {
  const worker = new SimWorker();
  worker.onmessage = (e: MessageEvent<FromSim>) => {
    deliver(e.data);
  };
  worker.onerror = (e) => {
    e.preventDefault();
    onFail();
  };
  const solver = connectSolver(worker);
  return {
    send: (msg) => {
      worker.postMessage(msg);
    },
    dispose: () => {
      worker.terminate();
      solver?.terminate();
    },
  };
}

/** Runs the same engine on the main thread, for browsers that refuse blob workers from file://. */
function inlineImpl(deliver: (msg: FromSim) => void): Impl {
  const engine = new SimEngine();
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    for (const m of engine.tick((now - last) / 1000)) deliver(m);
    last = now;
  }, 33);
  return {
    send: (msg) => {
      // Asynchronous like a worker, so callers behave the same either way.
      setTimeout(() => {
        for (const m of engine.handle(msg)) deliver(m);
      }, 0);
    },
    dispose: () => {
      clearInterval(timer);
    },
  };
}

/**
 * Starts the worker; if it fails before answering (e.g. a browser blocks blob workers on file://), switches to the
 * inline engine and replays everything sent so far.
 */
export function createSimHost(): SimHost {
  let listener: (msg: FromSim) => void = () => undefined;
  let answered = false;
  let kind: 'worker' | 'inline' = 'worker';
  const sent: ToSim[] = [];
  const deliver = (msg: FromSim): void => {
    answered = true;
    listener(msg);
  };
  let impl: Impl;
  const fallBack = (): void => {
    if (answered || kind === 'inline') return;
    impl.dispose();
    kind = 'inline';
    impl = inlineImpl(deliver);
    for (const m of sent) impl.send(m);
  };
  try {
    impl = workerImpl(deliver, fallBack);
  } catch {
    kind = 'inline';
    impl = inlineImpl(deliver);
  }
  return {
    kind: () => kind,
    send: (msg) => {
      if (!answered) sent.push(msg);
      impl.send(msg);
    },
    onMessage: (cb) => {
      listener = cb;
    },
    dispose: () => {
      impl.dispose();
    },
  };
}
