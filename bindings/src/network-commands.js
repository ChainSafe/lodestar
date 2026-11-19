// @ts-check

/**
 * @typedef {{run(): Promise<unknown>, resolve(value: unknown): void, reject(error: unknown): void,
 * key?: string, connectPeer?: string, token?: string}} Pending
 */
export class CommandQueue {
  #watch;
  /** @type {Set<Pending>} */
  #pending = new Set();
  /** @type {NodeJS.Immediate | undefined} */
  #scheduled;
  #closed = false;

  /** @param {(token: string) => boolean} watch */
  constructor(watch) {
    this.#watch = watch;
  }

  /**
   * @param {() => Promise<unknown>} run
   * @param {string | undefined} key
   * @param {string | undefined} connectPeer
   */
  submit(run, key, connectPeer) {
    return new Promise((resolve, reject) => {
      if (this.#closed) return reject(failure("NetworkClosed"));
      const wasEmpty = this.#pending.size === 0;
      this.#pending.add({connectPeer, key, reject, resolve, run});
      if (wasEmpty) this.#drain();
      else this.changed();
    });
  }

  changed() {
    if (this.#closed || this.#scheduled || this.#pending.size === 0) return;
    this.#scheduled = setImmediate(() => {
      this.#scheduled = undefined;
      this.#drain();
    });
  }

  /** @param {string} peer */
  cancelConnect(peer) {
    for (const pending of this.#pending) {
      if (pending.connectPeer !== peer) continue;
      this.#pending.delete(pending);
      pending.reject(failure("NetworkConnectCancelled"));
    }
  }

  #drain() {
    /** @type {Set<string>} */
    const blocked = new Set();
    /** @type {Map<string, boolean>} */
    const revisions = new Map();
    for (const pending of this.#pending) {
      if (pending.key !== undefined && blocked.has(pending.key)) continue;
      try {
        if (pending.token !== undefined) {
          if (!revisions.has(pending.token)) revisions.set(pending.token, this.#watch(pending.token));
          if (!revisions.get(pending.token)) {
            if (pending.key !== undefined) blocked.add(pending.key);
            continue;
          }
        }
        // Only synchronous admission refusal is retryable. An accepted command settles exactly once.
        const result = pending.run();
        this.#pending.delete(pending);
        result.then(pending.resolve, pending.reject);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "NetworkCommandFull" &&
          "capacityToken" in error &&
          typeof error.capacityToken === "string"
        ) {
          pending.token = error.capacityToken;
          if (pending.key !== undefined) blocked.add(pending.key);
          try {
            if (this.#watch(pending.token)) this.changed();
          } catch (error) {
            this.#pending.delete(pending);
            pending.reject(error);
          }
        } else {
          this.#pending.delete(pending);
          pending.reject(error);
        }
      }
    }
  }

  close() {
    this.#closed = true;
    clearImmediate(this.#scheduled);
    this.#scheduled = undefined;
    for (const pending of this.#pending) pending.reject(failure("NetworkClosed"));
    this.#pending.clear();
  }
}

/** @param {string} code */
function failure(code) {
  return Object.assign(new Error(code), {code});
}
