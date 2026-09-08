import bindings from "@chainsafe/lodestar-z";
import {Histogram} from "@lodestar/utils";
import {StateHashTreeRootSource} from "./stateTransition.js";

type StateHashTreeRootLabels = {source: StateHashTreeRootSource};

class NativeStateHashTreeRootMetric implements Histogram<StateHashTreeRootLabels> {
  startTimer(): (labels: StateHashTreeRootLabels) => number;
  startTimer<L extends Partial<StateHashTreeRootLabels>>(
    labels?: L
  ): keyof Omit<StateHashTreeRootLabels, keyof L> extends never
    ? () => number
    : (labels: Omit<StateHashTreeRootLabels, keyof L>) => number;
  startTimer(labels: Partial<StateHashTreeRootLabels> = {}): (endLabels?: Partial<StateHashTreeRootLabels>) => number {
    const startTime = performance.now();

    return (endLabels = {}) => {
      const source = endLabels.source ?? labels.source;
      if (source === undefined) {
        throw new Error("State hash tree root metric requires a source");
      }

      const seconds = (performance.now() - startTime) / 1000;
      bindings.metrics.observeStateHashTreeRoot(source, seconds);
      return seconds;
    };
  }

  observe(labels: StateHashTreeRootLabels, value: number): void {
    bindings.metrics.observeStateHashTreeRoot(labels.source, value);
  }

  reset(): void {}
}

let initialized = false;

export function initNativeStateTransitionMetrics(): void {
  if (initialized) return;
  bindings.metrics.init();
  initialized = true;
}

export function createNativeStateHashTreeRootMetric(): Histogram<StateHashTreeRootLabels> {
  initNativeStateTransitionMetrics();
  return new NativeStateHashTreeRootMetric();
}

export function scrapeNativeStateTransitionMetrics(): string {
  if (!initialized) return "";
  return bindings.metrics.scrapeMetrics();
}
