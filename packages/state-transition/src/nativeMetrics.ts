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
