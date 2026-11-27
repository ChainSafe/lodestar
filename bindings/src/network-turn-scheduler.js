// @ts-check
/**
 * @typedef {"now" | "idle"} Continuation
 * @typedef {{turn(): Continuation}} Pump
 */

/**
 * Schedules one pump's bounded turns through shutdown. Referenced immediates keep completion delivery alive after
 * native releases its notifier.
 */
export class TurnScheduler {
  #pump;
  #scheduled = false;
  #stopped = false;

  /** @param {Pump} pump */
  constructor(pump) {
    this.#pump = pump;
  }

  schedule() {
    if (this.#scheduled || this.#stopped) return;
    this.#scheduled = true;
    setImmediate(TurnScheduler.#run, this);
  }

  /** Native reported closed. */
  stop() {
    this.#stopped = true;
  }

  /** @param {TurnScheduler} scheduler */
  static #run(scheduler) {
    scheduler.#scheduled = false;
    if (scheduler.#stopped) return;
    scheduler.#continue(scheduler.#pump.turn());
  }

  /** @param {Continuation} next */
  #continue(next) {
    switch (next) {
      case "now":
        this.schedule();
        break;
      case "idle":
        break;
      default: {
        /** @type {never} */
        const invalid = next;
        throw new Error(`Invalid turn continuation: ${invalid}`);
      }
    }
  }
}
