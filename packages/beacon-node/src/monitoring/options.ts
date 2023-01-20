import {MONITORING_UPDATE_INTERVAL_SECONDS} from "./service.js";

export type MonitoringOptions = {
  /** Remote endpoint where client stats are sent */
  endpoint: string;
  /** Interval in seconds between sending client stats */
  interval?: number;
};

export const defaultMonitoringOptions: MonitoringOptions = {
  endpoint: "",
  interval: MONITORING_UPDATE_INTERVAL_SECONDS,
};
