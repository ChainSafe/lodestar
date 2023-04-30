import {Type} from "@chainsafe/ssz";
import {ForkLightClient, ForkName, isForkLightClient} from "@lodestar/params";
import {Protocol} from "@lodestar/reqresp";
import {allForks, altair, deneb, phase0, ssz} from "@lodestar/types";

export type ProtocolNoHandler = Omit<Protocol, "handler">;

/** ReqResp protocol names or methods. Each ReqRespMethod can have multiple versions and encodings */
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

type ResponseBodyByMethod = {
  [ReqRespMethod.Status]: phase0.Status;
  [ReqRespMethod.Goodbye]: phase0.Goodbye;
  [ReqRespMethod.Ping]: phase0.Ping;
  [ReqRespMethod.Metadata]: allForks.Metadata;
  // Do not matter
  [ReqRespMethod.BeaconBlocksByRange]: allForks.SignedBeaconBlock;
  [ReqRespMethod.BeaconBlocksByRoot]: allForks.SignedBeaconBlock;
  [ReqRespMethod.BlobsSidecarsByRange]: deneb.BlobsSidecar;
  [ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot]: deneb.SignedBeaconBlockAndBlobsSidecar;
  [ReqRespMethod.LightClientBootstrap]: altair.LightClientBootstrap;
  [ReqRespMethod.LightClientUpdatesByRange]: altair.LightClientUpdate;
  [ReqRespMethod.LightClientFinalityUpdate]: altair.LightClientFinalityUpdate;
  [ReqRespMethod.LightClientOptimisticUpdate]: altair.LightClientOptimisticUpdate;
};

/** Request SSZ type for each method and ForkName */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getRequestSzzTypeByMethod(method: ReqRespMethod) {
  switch (method) {
    case ReqRespMethod.Status:
      return ssz.phase0.Status;
    case ReqRespMethod.Goodbye:
      return ssz.phase0.Goodbye;
    case ReqRespMethod.Ping:
      return ssz.phase0.Ping;
    case ReqRespMethod.Metadata:
    case ReqRespMethod.LightClientFinalityUpdate:
    case ReqRespMethod.LightClientOptimisticUpdate:
      return null;
    case ReqRespMethod.BeaconBlocksByRange:
      return ssz.phase0.BeaconBlocksByRangeRequest;
    case ReqRespMethod.BeaconBlocksByRoot:
      return ssz.phase0.BeaconBlocksByRootRequest;
    case ReqRespMethod.BlobsSidecarsByRange:
      return ssz.deneb.BlobsSidecarsByRangeRequest;
    case ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot:
      return ssz.deneb.BeaconBlockAndBlobsSidecarByRootRequest;
    case ReqRespMethod.LightClientBootstrap:
      return ssz.Root;
    case ReqRespMethod.LightClientUpdatesByRange:
      return ssz.altair.LightClientUpdatesByRange;
  }
}

export type ResponseTypeGetter<T> = (fork: ForkName, version: number) => Type<T>;

const blocksResponseType: ResponseTypeGetter<allForks.SignedBeaconBlock> = (fork, version) => {
  if (version === Version.V1) {
    return ssz.phase0.SignedBeaconBlock;
  } else {
    return ssz[fork].SignedBeaconBlock;
  }
};

export const responseSszTypeByMethod: {[K in ReqRespMethod]: ResponseTypeGetter<ResponseBodyByMethod[K]>} = {
  [ReqRespMethod.Status]: () => ssz.phase0.Status,
  [ReqRespMethod.Goodbye]: () => ssz.phase0.Goodbye,
  [ReqRespMethod.Ping]: () => ssz.phase0.Ping,
  [ReqRespMethod.Metadata]: (_, version) => (version == Version.V1 ? ssz.phase0.Metadata : ssz.altair.Metadata),
  [ReqRespMethod.BeaconBlocksByRange]: blocksResponseType,
  [ReqRespMethod.BeaconBlocksByRoot]: blocksResponseType,
  [ReqRespMethod.BlobsSidecarsByRange]: () => ssz.deneb.BlobsSidecar,
  [ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot]: () => ssz.deneb.SignedBeaconBlockAndBlobsSidecar,
  [ReqRespMethod.LightClientBootstrap]: (fork) =>
    ssz.allForksLightClient[onlyLightclientFork(fork)].LightClientBootstrap,
  [ReqRespMethod.LightClientUpdatesByRange]: (fork) =>
    ssz.allForksLightClient[onlyLightclientFork(fork)].LightClientUpdate,
  [ReqRespMethod.LightClientFinalityUpdate]: (fork) =>
    ssz.allForksLightClient[onlyLightclientFork(fork)].LightClientFinalityUpdate,
  [ReqRespMethod.LightClientOptimisticUpdate]: (fork) =>
    ssz.allForksLightClient[onlyLightclientFork(fork)].LightClientOptimisticUpdate,
};

function onlyLightclientFork(fork: ForkName): ForkLightClient {
  if (isForkLightClient(fork)) {
    return fork;
  } else {
    throw Error(`Not a lightclient fork ${fork}`);
  }
}

export type RequestTypedContainer = {
  [K in ReqRespMethod]: {method: K; body: RequestBodyByMethod[K]};
}[ReqRespMethod];

export enum Version {
  V1 = 1,
  V2 = 2,
}
