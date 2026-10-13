/**
 * Stage 3 placeholder. Every public function of a module whose tests are written but whose implementation is not
 * is a stub that calls this, so the tests compile and fail with a clear message. Stage 4 removes all callers.
 */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Not implemented: ${what}`);
    this.name = 'NotImplementedError';
  }
}

/** Throws NotImplementedError. The extra arguments only mark the stub's parameters as used. */
export function notImplemented(what: string, ...args: unknown[]): never {
  throw new NotImplementedError(`${what} (${String(args.length)} args)`);
}
