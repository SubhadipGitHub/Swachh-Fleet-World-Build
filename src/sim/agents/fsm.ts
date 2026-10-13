/** Thrown when an input is not valid in the current state (architecture §4). */
export class IllegalTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly stateKind: string,
    readonly inputKind: string,
  ) {
    super(`${machine}: ${inputKind} is not valid in state ${stateKind}`);
    this.name = 'IllegalTransitionError';
  }
}
