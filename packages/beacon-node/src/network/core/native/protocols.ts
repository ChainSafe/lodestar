import {NativeProtocolId, NetworkFork} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {ForkName, isForkPostGloas} from "@lodestar/params";
import {ContextBytesType} from "@lodestar/reqresp";
import * as protocols from "../../reqresp/protocols.js";
import {ProtocolNoHandler, ReqRespMethod} from "../../reqresp/types.js";
import {NativeNetworkError, NativeNetworkErrorCode} from "./errors.js";

const factories = [
  protocols.Ping,
  protocols.Goodbye,
  protocols.Status,
  protocols.StatusV2,
  protocols.Metadata,
  protocols.MetadataV2,
  protocols.MetadataV3,
  protocols.BeaconBlocksByRangeV2,
  protocols.BeaconBlocksByRootV2,
  protocols.BeaconBlocksByHead,
  protocols.BlobSidecarsByRange,
  protocols.BlobSidecarsByRoot,
  protocols.DataColumnSidecarsByRange,
  protocols.DataColumnSidecarsByRoot,
  protocols.LightClientBootstrap,
  protocols.LightClientUpdatesByRange,
  protocols.LightClientFinalityUpdate,
  protocols.LightClientOptimisticUpdate,
];

export type NativeProtocol = {
  id: NativeProtocolId;
  method: ReqRespMethod;
  version: number;
  context: boolean;
};

const protocolIds: readonly NativeProtocolId[] = [
  "/eth2/beacon_chain/req/ping/1/ssz_snappy",
  "/eth2/beacon_chain/req/goodbye/1/ssz_snappy",
  "/eth2/beacon_chain/req/status/1/ssz_snappy",
  "/eth2/beacon_chain/req/status/2/ssz_snappy",
  "/eth2/beacon_chain/req/metadata/1/ssz_snappy",
  "/eth2/beacon_chain/req/metadata/2/ssz_snappy",
  "/eth2/beacon_chain/req/metadata/3/ssz_snappy",
  "/eth2/beacon_chain/req/beacon_blocks_by_range/2/ssz_snappy",
  "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy",
  "/eth2/beacon_chain/req/beacon_blocks_by_head/1/ssz_snappy",
  "/eth2/beacon_chain/req/blob_sidecars_by_range/1/ssz_snappy",
  "/eth2/beacon_chain/req/blob_sidecars_by_root/1/ssz_snappy",
  "/eth2/beacon_chain/req/data_column_sidecars_by_range/1/ssz_snappy",
  "/eth2/beacon_chain/req/data_column_sidecars_by_root/1/ssz_snappy",
  "/eth2/beacon_chain/req/light_client_bootstrap/1/ssz_snappy",
  "/eth2/beacon_chain/req/light_client_updates_by_range/1/ssz_snappy",
  "/eth2/beacon_chain/req/light_client_finality_update/1/ssz_snappy",
  "/eth2/beacon_chain/req/light_client_optimistic_update/1/ssz_snappy",
];

export function nativeFork(fork: ForkName): NetworkFork {
  if (isForkPostGloas(fork))
    throw new NativeNetworkError({
      code: NativeNetworkErrorCode.CONFIGURATION,
      resource: `Unsupported native fork ${fork}`,
    });
  return fork;
}

export function nativeProtocols(config: BeaconConfig, fork: ForkName): ReadonlyMap<string, NativeProtocol> {
  const result = new Map<string, NativeProtocol>();
  for (const factory of factories) {
    const protocol: ProtocolNoHandler = factory(fork, config);
    const id = protocolIds.find(
      (id) => id === `/eth2/beacon_chain/req/${protocol.method}/${protocol.version}/${protocol.encoding}`
    );
    const method = Object.values(ReqRespMethod).find((method) => method === protocol.method);
    if (!id || !method)
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "protocol mapping"});
    result.set(id, {
      id,
      method,
      version: protocol.version,
      context: protocol.contextBytes.type === ContextBytesType.ForkDigest,
    });
  }
  return result;
}
