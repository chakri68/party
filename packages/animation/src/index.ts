// Stub (§19). Phase 5 swaps in a real queue; the contract is already the one the
// room view relies on: enqueue steps, get told when the queue drains.

export interface AnimationStep {
  type: string;
  run(): Promise<void>;
}

export class AnimationQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue(step: AnimationStep): Promise<void> {
    this.tail = this.tail.then(() => step.run()).catch(() => {});
    return this.tail;
  }

  /** Resolves once everything queued so far has played. */
  drained(): Promise<void> {
    return this.tail;
  }

  /** Drop anything pending, e.g. on a snapshot (§12). Stub: nothing to drop. */
  clear(): void {
    this.tail = Promise.resolve();
  }
}
