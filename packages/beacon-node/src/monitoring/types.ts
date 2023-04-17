import {ClientStatsProperty} from "./properties.js";

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
