type LabelValues<T extends string> = Partial<Record<T, string | number>>;

interface Gauge<T extends string = string> {
  // Sorry for this mess, `prom-client` API choices are not great
  // If the function signature was `inc(value: number, labels?: Labels)`, this would be simpler
  inc(value?: number): void;
  inc(labels: LabelValues<T>, value?: number): void;
  inc(arg1?: LabelValues<T> | number, arg2?: number): void;

  dec(value?: number): void;
  dec(labels: LabelValues<T>, value?: number): void;
  dec(arg1?: LabelValues<T> | number, arg2?: number): void;

  set(value: number): void;
  set(labels: LabelValues<T>, value: number): void;
  set(arg1?: LabelValues<T> | number, arg2?: number): void;

  addCollect: (collectFn: () => void) => void;
}

interface Histogram<T extends string = string> {
  startTimer(arg1?: LabelValues<T>): (labels?: LabelValues<T>) => number;

  observe(value: number): void;
  observe(labels: LabelValues<T>, values: number): void;
  observe(arg1: LabelValues<T> | number, arg2?: number): void;

  reset(): void;
}

type GaugeConfig<T extends string = string> = {
  name: string;
  help: string;
  labelNames?: T[];
};

type HistogramConfig<T extends string = string> = {
  name: string;
  help: string;
  labelNames?: T[];
  buckets?: number[];
};

export interface MetricsRegister {
  gauge<T extends string = string>(config: GaugeConfig<T>): Gauge<T>;
  histogram<T extends string = string>(config: HistogramConfig<T>): Histogram<T>;
}

export type Metrics = ReturnType<typeof getMetrics>;

export type LodestarGitData = {
  /** "0.16.0 developer/feature-1 ac99f2b5" */
  version: string;
  /** "4f816b16dfde718e2d74f95f2c8292596138c248" */
  commit: string;
  /** "goerli" */
  network: string;
};

/**
 * A collection of metrics used throughout the Gossipsub behaviour.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function getMetrics(register: MetricsRegister) {
  // Using function style instead of class to prevent having to re-declare all MetricsPrometheus types.

  return {
    outgoingRequests: register.gauge<"method">({
      name: "beacon_reqresp_outgoing_requests_total",
      help: "Counts total requests done per method",
      labelNames: ["method"],
    }),
    outgoingRequestRoundtripTime: register.histogram<"method">({
      name: "beacon_reqresp_outgoing_request_roundtrip_time_seconds",
      help: "Histogram of outgoing requests round-trip time",
      labelNames: ["method"],
      buckets: [0.1, 0.2, 0.5, 1, 5, 15, 60],
    }),
    outgoingErrors: register.gauge<"method">({
      name: "beacon_reqresp_outgoing_requests_error_total",
      help: "Counts total failed requests done per method",
      labelNames: ["method"],
    }),
    incomingRequests: register.gauge<"method">({
      name: "beacon_reqresp_incoming_requests_total",
      help: "Counts total responses handled per method",
      labelNames: ["method"],
    }),
    incomingRequestHandlerTime: register.histogram<"method">({
      name: "beacon_reqresp_incoming_request_handler_time_seconds",
      help: "Histogram of incoming requests internal handling time",
      labelNames: ["method"],
      buckets: [0.1, 0.2, 0.5, 1, 5],
    }),
    incomingErrors: register.gauge<"method">({
      name: "beacon_reqresp_incoming_requests_error_total",
      help: "Counts total failed responses handled per method",
      labelNames: ["method"],
    }),
    dialErrors: register.gauge({
      name: "beacon_reqresp_dial_errors_total",
      help: "Count total dial errors",
    }),
  };
}
