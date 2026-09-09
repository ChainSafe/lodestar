import bindings from "@chainsafe/lodestar-z";

type SplitNativeMetrics = typeof bindings.metrics & {
  scrapeStateTransitionMetrics?: () => string;
  scrapeValidatorMonitorMetrics?: () => string;
};

const nativeMetrics = bindings.metrics as SplitNativeMetrics;
const validatorMonitorMetricLine = /^(?:# (?:HELP|TYPE) )?validator_monitor_/;

let initialized = false;

export function initNativeStateTransitionMetrics(): void {
  if (initialized) return;
  nativeMetrics.init();
  initialized = true;
}

export function scrapeNativeStateTransitionMetrics(): string {
  if (!initialized) return "";
  return (
    nativeMetrics.scrapeStateTransitionMetrics?.() ??
    nativeMetrics
      .scrapeMetrics()
      .split("\n")
      .filter((line) => !validatorMonitorMetricLine.test(line))
      .join("\n")
  );
}

export function scrapeNativeValidatorMonitorMetrics(): string {
  if (!initialized) return "";
  return (
    nativeMetrics.scrapeValidatorMonitorMetrics?.() ??
    nativeMetrics
      .scrapeMetrics()
      .split("\n")
      .filter((line) => line.length === 0 || validatorMonitorMetricLine.test(line))
      .join("\n")
  );
}
