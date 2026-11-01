/** Native log records delivered to the host every `LOG_MS`, at most `LOG_RECORDS` per delivery. */
export const LOG_MS = 100;
export const LOG_RECORDS = 256;
/** Deliveries of the final drain once native closed. */
const LOG_FINAL = 8;
export const LOG_ERRORS_NAME = "lodestar_network_log_delivery_errors_total";
export const LOG_DRAIN_ERRORS_NAME = "lodestar_network_log_drain_errors_total";

/** Delivers bounded log batches until the pump stops it after native closes. */
export class LogDelivery {
  #runtime;
  #host;
  #onError;
  #stopped = false;
  #logTimer = undefined;
  #logErrors = 0;
  #drainErrors = 0;

  constructor(runtime, host, onError) {
    this.#runtime = runtime;
    this.#host = host;
    this.#onError = onError;
  }

  stop() {
    this.#stopped = true;
    if (this.#logTimer) clearTimeout(this.#logTimer);
    this.#logTimer = undefined;
    this.#deliverLogs(LOG_FINAL);
  }

  start() {
    this.#logTimer = setTimeout(LogDelivery.#logFired, LOG_MS, this).unref();
  }

  static #logFired(logs) {
    if (logs.#stopped) return;
    logs.#deliverLogs(1);
    logs.start();
  }

  #deliverLogs(deliveries) {
    for (let i = 0; i < deliveries; i++) {
      let batch;
      try {
        batch = this.#runtime.drainLogs(LOG_RECORDS);
      } catch (error) {
        this.#drainErrors++;
        this.#onError(error);
        return;
      }
      if (batch.records.length > 0) {
        try {
          this.#host.logs(batch.records);
        } catch {
          this.#logErrors += batch.records.length;
        }
      }
      if (!batch.more) return;
    }
  }

  metrics() {
    return [
      `# HELP ${LOG_ERRORS_NAME} Native log records that left the native queue but did not reach the host's log handler`,
      `# TYPE ${LOG_ERRORS_NAME} counter`,
      `${LOG_ERRORS_NAME} ${this.#logErrors}`,
      `# HELP ${LOG_DRAIN_ERRORS_NAME} Failed attempts to drain native log records`,
      `# TYPE ${LOG_DRAIN_ERRORS_NAME} counter`,
      `${LOG_DRAIN_ERRORS_NAME} ${this.#drainErrors}`,
      "",
    ].join("\n");
  }
}
