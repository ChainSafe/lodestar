import {phase0} from "@lodestar/types";

/** ReqResp protocol names or methods. Each Method can have multiple versions and encodings */
export enum ReqRespMethod {
  // Phase 0
  Status = "status",
  Goodbye = "goodbye",
  Ping = "ping",
  Metadata = "metadata",
  BeaconBlocksByRange = "beacon_blocks_by_range",
  BeaconBlocksByRoot = "beacon_blocks_by_root",
  BlobsSidecarsByRange = "blobs_sidecars_by_range",
  BeaconBlockAndBlobsSidecarByRoot = "beacon_block_and_blobs_sidecar_by_root",
  LightClientBootstrap = "light_client_bootstrap",
  LightClientUpdatesByRange = "light_client_updates_by_range",
  LightClientFinalityUpdate = "light_client_finality_update",
  LightClientOptimisticUpdate = "light_client_optimistic_update",
}

// To typesafe events to network
type RequestBodyByMethod = {
  [ReqRespMethod.Status]: phase0.Status;
  [ReqRespMethod.Goodbye]: phase0.Goodbye;
  [ReqRespMethod.Ping]: phase0.Ping;
  [ReqRespMethod.Metadata]: null;
  // Do not matter
  [ReqRespMethod.BeaconBlocksByRange]: unknown;
  [ReqRespMethod.BeaconBlocksByRoot]: unknown;
  [ReqRespMethod.BlobsSidecarsByRange]: unknown;
  [ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot]: unknown;
  [ReqRespMethod.LightClientBootstrap]: unknown;
  [ReqRespMethod.LightClientUpdatesByRange]: unknown;
  [ReqRespMethod.LightClientFinalityUpdate]: unknown;
  [ReqRespMethod.LightClientOptimisticUpdate]: unknown;
};

export type RequestTypedContainer = {
  [K in ReqRespMethod]: {method: K; body: RequestBodyByMethod[K]};
}[ReqRespMethod];

export enum Version {
  V1 = 1,
  V2 = 2,
}
