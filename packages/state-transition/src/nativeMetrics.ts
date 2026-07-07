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
