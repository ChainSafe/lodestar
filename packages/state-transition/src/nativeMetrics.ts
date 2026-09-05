import bindings from "@chainsafe/lodestar-z";

let initialized = false;

export function initNativeStateTransitionMetrics(options?: {historical?: boolean}): void {
  bindings.metrics.init(options);
  initialized = true;
}

export function scrapeNativeStateTransitionMetrics(): string {
  if (!initialized) return "";
  return bindings.metrics.scrapeMetrics();
}
