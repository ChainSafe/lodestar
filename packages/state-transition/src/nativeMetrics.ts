import bindings from "@chainsafe/lodestar-z";

let initialized = false;

export function initNativeStateTransitionMetrics(): void {
  if (initialized) return;
  bindings.metrics.init();
  initialized = true;
}

export function scrapeNativeStateTransitionMetrics(): string {
  if (!initialized) return "";
  return bindings.metrics.scrapeMetrics();
}

/**
 * Register a validator index with the native validator monitor.
 *
 * The native state transition records validator status metrics
 * for registered validators on every epoch transition, mirroring
 * `validatorMonitor.registerValidatorStatuses()`.
 *
 * No-op unless native state-transition metrics have been initialized.
 */
export function registerNativeLocalValidator(index: number): void {
  if (!initialized) return;
  bindings.metrics.registerLocalValidator(index);
}

/**
 * Remove a validator index from the native validator monitor, so its
 * `validator_monitor_*` status metrics stop being recorded.
 *
 * Should mirror the pruning of stale registrations in the TS validator monitor.
 * No-op unless native state-transition metrics have been initialized.
 */
export function unregisterNativeLocalValidator(index: number): void {
  if (!initialized) return;
  bindings.metrics.unregisterLocalValidator(index);
}
