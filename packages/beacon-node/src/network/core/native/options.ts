import {ServingOptions} from "../../reqresp/serving/policy.js";

export type NativeBackendOptions = {
  profile?: "small" | "beaconNode";
  nativeBudgetBytes?: number;
  bridgeBudgetBytes?: number;
  receiveBudgetBytes?: number;
  hostGossipItems?: number;
  hostGossipBytes?: number;
  serving?: ServingOptions;
};
