// The Dynamic planner in its own Web Worker (architecture M3-D9). It talks only to the sim worker, over the
// MessagePort the main thread hands it, and answers each plan request with a plan or an error.
import { planDynamic } from '../sim/policies/dynamic';
import type { FromSolver, SolverConnect, ToSolver } from './protocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent<SolverConnect>) => void) | null;
}
const scope = self as unknown as WorkerScope;

function answer(msg: ToSolver): FromSolver | null {
  // Validated at run time: only the sim worker holds the port, but a malformed message must not crash the solver.
  if ((msg as { type?: unknown }).type !== 'solve' || !Number.isInteger(msg.request.reqId)) return null;
  try {
    return { type: 'plan', plan: planDynamic(msg.request) };
  } catch (e) {
    return { type: 'planError', reqId: msg.request.reqId, message: e instanceof Error ? e.message : String(e) };
  }
}

scope.onmessage = (e) => {
  if (e.data.type !== 'connect') return;
  const port = e.data.port;
  port.onmessage = (m: MessageEvent<ToSolver>) => {
    const reply = answer(m.data);
    if (reply) port.postMessage(reply);
  };
};
