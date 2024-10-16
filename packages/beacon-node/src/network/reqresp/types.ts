import {Type} from "@chainsafe/ssz";
import {ForkLightClient, ForkName, isForkLightClient} from "@lodestar/params";
import {Protocol, ProtocolHandler, ReqRespRequest} from "@lodestar/reqresp";
import {
  LightClientBootstrap,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  Metadata,
  Root,
  SignedBeaconBlock,
  altair,
  deneb,
  phase0,
  ssz,
  sszTypesFor,
} from "@lodestar/types";

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
  BlobSidecarsByRange = "blob_sidecars_by_range",
  BlobSidecarsByRoot = "blob_sidecars_by_root",
  LightClientBootstrap = "light_client_bootstrap",
  LightClientUpdatesByRange = "light_client_updates_by_range",
  LightClientFinalityUpdate = "light_client_finality_update",
  LightClientOptimisticUpdate = "light_client_optimistic_update",
}

// To typesafe events to network
export type RequestBodyByMethod = {
  [ReqRespMethod.Status]: phase0.Status;
  [ReqRespMethod.Goodbye]: phase0.Goodbye;
  [ReqRespMethod.Ping]: phase0.Ping;
  [ReqRespMethod.Metadata]: null;
  [ReqRespMethod.BeaconBlocksByRange]: phase0.BeaconBlocksByRangeRequest;
  [ReqRespMethod.BeaconBlocksByRoot]: phase0.BeaconBlocksByRootRequest;
  [ReqRespMethod.BlobSidecarsByRange]: deneb.BlobSidecarsByRangeRequest;
  [ReqRespMethod.BlobSidecarsByRoot]: deneb.BlobSidecarsByRootRequest;
  [ReqRespMethod.LightClientBootstrap]: Root;
  [ReqRespMethod.LightClientUpdatesByRange]: altair.LightClientUpdatesByRange;
  [ReqRespMethod.LightClientFinalityUpdate]: null;
  [ReqRespMethod.LightClientOptimisticUpdate]: null;
};

type ResponseBodyByMethod = {
  [ReqRespMethod.Status]: phase0.Status;
  [ReqRespMethod.Goodbye]: phase0.Goodbye;
  [ReqRespMethod.Ping]: phase0.Ping;
  [ReqRespMethod.Metadata]: Metadata;
  // Do not matter
  [ReqRespMethod.BeaconBlocksByRange]: SignedBeaconBlock;
  [ReqRespMethod.BeaconBlocksByRoot]: SignedBeaconBlock;
  [ReqRespMethod.BlobSidecarsByRange]: deneb.BlobSidecar;
  [ReqRespMethod.BlobSidecarsByRoot]: deneb.BlobSidecar;
  [ReqRespMethod.LightClientBootstrap]: LightClientBootstrap;
  [ReqRespMethod.LightClientUpdatesByRange]: LightClientUpdate;
  [ReqRespMethod.LightClientFinalityUpdate]: LightClientFinalityUpdate;
  [ReqRespMethod.LightClientOptimisticUpdate]: LightClientOptimisticUpdate;
};

/** Request SSZ type for each method and ForkName */
export const requestSszTypeByMethod: {
  [K in ReqRespMethod]: RequestBodyByMethod[K] extends null ? null : Type<RequestBodyByMethod[K]>;
} = {
  [ReqRespMethod.Status]: ssz.phase0.Status,
  [ReqRespMethod.Goodbye]: ssz.phase0.Goodbye,
  [ReqRespMethod.Ping]: ssz.phase0.Ping,
  [ReqRespMethod.Metadata]: null,
  [ReqRespMethod.BeaconBlocksByRange]: ssz.phase0.BeaconBlocksByRangeRequest,
  [ReqRespMethod.BeaconBlocksByRoot]: ssz.phase0.BeaconBlocksByRootRequest,
  [ReqRespMethod.BlobSidecarsByRange]: ssz.deneb.BlobSidecarsByRangeRequest,
  [ReqRespMethod.BlobSidecarsByRoot]: ssz.deneb.BlobSidecarsByRootRequest,
  [ReqRespMethod.LightClientBootstrap]: ssz.Root,
  [ReqRespMethod.LightClientUpdatesByRange]: ssz.altair.LightClientUpdatesByRange,
  [ReqRespMethod.LightClientFinalityUpdate]: null,
  [ReqRespMethod.LightClientOptimisticUpdate]: null,
};

export type ResponseTypeGetter<T> = (fork: ForkName, version: number) => Type<T>;

const blocksResponseType: ResponseTypeGetter<SignedBeaconBlock> = (fork, version) => {
  if (version === Version.V1) {
    return ssz.phase0.SignedBeaconBlock;
  }

  return ssz[fork].SignedBeaconBlock;
};

export const responseSszTypeByMethod: {[K in ReqRespMethod]: ResponseTypeGetter<ResponseBodyByMethod[K]>} = {
  [ReqRespMethod.Status]: () => ssz.phase0.Status,
  [ReqRespMethod.Goodbye]: () => ssz.phase0.Goodbye,
  [ReqRespMethod.Ping]: () => ssz.phase0.Ping,
  [ReqRespMethod.Metadata]: (_, version) => (version === Version.V1 ? ssz.phase0.Metadata : ssz.altair.Metadata),
  [ReqRespMethod.BeaconBlocksByRange]: blocksResponseType,
  [ReqRespMethod.BeaconBlocksByRoot]: blocksResponseType,
  [ReqRespMethod.BlobSidecarsByRange]: () => ssz.deneb.BlobSidecar,
  [ReqRespMethod.BlobSidecarsByRoot]: () => ssz.deneb.BlobSidecar,
  [ReqRespMethod.LightClientBootstrap]: (fork) => sszTypesFor(onlyLightclientFork(fork)).LightClientBootstrap,
  [ReqRespMethod.LightClientUpdatesByRange]: (fork) => sszTypesFor(onlyLightclientFork(fork)).LightClientUpdate,
  [ReqRespMethod.LightClientFinalityUpdate]: (fork) => sszTypesFor(onlyLightclientFork(fork)).LightClientFinalityUpdate,
  [ReqRespMethod.LightClientOptimisticUpdate]: (fork) =>
    sszTypesFor(onlyLightclientFork(fork)).LightClientOptimisticUpdate,
};

function onlyLightclientFork(fork: ForkName): ForkLightClient {
  if (isForkLightClient(fork)) {
    return fork;
  }
  throw Error(`Not a lightclient fork ${fork}`);
}

export type RequestTypedContainer = {
  [K in ReqRespMethod]: {method: K; body: RequestBodyByMethod[K]};
}[ReqRespMethod];

export enum Version {
  V1 = 1,
  V2 = 2,
}

export type OutgoingRequestArgs = {
  peerId: string;
  method: ReqRespMethod;
  versions: number[];
  requestData: Uint8Array;
};

export type IncomingRequestArgs = {
  method: ReqRespMethod;
  req: ReqRespRequest;
  peerId: string;
};

export type GetReqRespHandlerFn = (method: ReqRespMethod) => ProtocolHandler;
