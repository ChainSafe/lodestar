import {phase0} from "@lodestar/types";

/** ReqResp protocol names or methods. Each Method can have multiple versions and encodings */
export enum Method {
  // Phase 0
  Status = "status",
  Goodbye = "goodbye",
  Ping = "ping",
  Metadata = "metadata",
  BeaconBlocksByRange = "beacon_blocks_by_range",
  BeaconBlocksByRoot = "beacon_blocks_by_root",
  LightClientBootstrap = "light_client_bootstrap",
  LightClientUpdatesByRange = "light_client_updates_by_range",
  LightClientFinalityUpdate = "light_client_finality_update",
  LightClientOptimisticUpdate = "light_client_optimistic_update",
}

// To typesafe events to network
type RequestBodyByMethod = {
  [Method.Status]: phase0.Status;
  [Method.Goodbye]: phase0.Goodbye;
  [Method.Ping]: phase0.Ping;
  [Method.Metadata]: null;
  // Do not matter
  [Method.BeaconBlocksByRange]: unknown;
  [Method.BeaconBlocksByRoot]: unknown;
  [Method.LightClientBootstrap]: unknown;
  [Method.LightClientUpdatesByRange]: unknown;
  [Method.LightClientFinalityUpdate]: unknown;
  [Method.LightClientOptimisticUpdate]: unknown;
};

export type RequestTypedContainer = {
  [K in Method]: {method: K; body: RequestBodyByMethod[K]};
}[Method];

export enum Version {
  V1 = 1,
  V2 = 2,
}
