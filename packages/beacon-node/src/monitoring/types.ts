import {Metric} from "prom-client";
import {ClientStatsProperty} from "./properties.js";

// get methods are missing in prom-client type definitions
// see https://github.com/siimon/prom-client/pull/531
export type MetricWithGetter = Metric & {
  get(): Promise<MetricObject>;
};

export type MetricObject = {
  values: Array<{value: number; labels: Record<string, string>}>;
};

export type MetricValue = string | number;

export type RecordValue = string | number | boolean;

export type JsonRecord<T extends RecordValue> = {key: string; value: T};

export type ClientStats = Record<string, ClientStatsProperty<RecordValue>>;

export enum ProcessType {
  BeaconNode = "beaconnode",
  Validator = "validator",
  System = "system",
}

export enum JsonType {
  String,
  Number,
  Boolean,
}
