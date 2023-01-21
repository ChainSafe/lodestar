export type MonitoringOptions = {
  /** Remote endpoint URL where client stats are sent */
  endpoint: string;
  /** Interval in seconds between sending client stats */
  interval?: number;
  /** Initial delay in seconds before client stats are sent */
  initialDelay?: number;
};

export const defaultMonitoringOptions: Required<MonitoringOptions> = {
  endpoint: "",
  interval: 60,
  initialDelay: 30,
};
