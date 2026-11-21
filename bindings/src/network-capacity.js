// @ts-check

// Node converts larger setTimeout delays to 1 ms.
const TIMER_MAX_MS = 2 ** 31 - 1;

/** @param {string} code */
function failure(code) {
  return Object.assign(new Error(code), {code});
}

/**
 * @typedef {{token: string, finish(error?: unknown): void}} Waiter
 */
class CapacityWaiters {
  #watch;
  #prefix;
  /** @type {Set<Waiter>} */
  #waiters = new Set();
  #closed = false;

  /**
   * @param {(token: string) => boolean} watch
   * @param {string} prefix
   */
  constructor(watch, prefix) {
    this.#watch = watch;
    this.#prefix = prefix;
  }

  /**
   * @param {string} token
   * @param {{signal: AbortSignal, timeoutMs: number}} options
   * @returns {Promise<void>}
   */
  async wait(token, {signal, timeoutMs}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMER_MAX_MS)
      throw failure(`Invalid${this.#prefix}CapacityTimeout`);
    if (typeof signal?.addEventListener !== "function" || typeof signal?.removeEventListener !== "function")
      throw failure(`Invalid${this.#prefix}CapacitySignal`);
    if (this.#closed) throw failure("NetworkClosed");
    if (signal.aborted) throw failure(`Network${this.#prefix}CapacityCancelled`);
    return new Promise((resolve, reject) => {
      const abort = () => waiter.finish(failure(`Network${this.#prefix}CapacityCancelled`));
      const timer = setTimeout(() => waiter.finish(failure(`Network${this.#prefix}CapacityTimeout`)), timeoutMs);
      /** @type {Waiter} */
      const waiter = {
        finish: (error) => {
          if (!this.#waiters.delete(waiter)) return;
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          if (error !== undefined) reject(error);
          else resolve();
        },
        token,
      };
      this.#waiters.add(waiter);
      signal.addEventListener("abort", abort, {once: true});
      if (signal.aborted) abort();
      else this.#check(waiter);
    });
  }

  changed() {
    for (const waiter of this.#waiters) this.#check(waiter);
  }

  /** @param {Waiter} waiter */
  #check(waiter) {
    try {
      if (this.#watch(waiter.token)) waiter.finish();
    } catch (error) {
      waiter.finish(error);
    }
  }

  close() {
    this.#closed = true;
    for (const waiter of this.#waiters) waiter.finish(failure("NetworkClosed"));
  }
}

export class RequestCapacityWaiters extends CapacityWaiters {
  /** @param {{requestCapacityWatch(token: string): boolean}} runtime */
  constructor(runtime) {
    super((token) => runtime.requestCapacityWatch(token), "Request");
  }
}

export class PublicationCapacityWaiters extends CapacityWaiters {
  /** @param {{publicationCapacityWatch(token: string): boolean}} runtime */
  constructor(runtime) {
    super((token) => runtime.publicationCapacityWatch(token), "Publication");
  }
}
