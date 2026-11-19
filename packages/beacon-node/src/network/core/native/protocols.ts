import {NativeRequestProtocolId} from "@lodestar/native/network";
import {ReqRespMethod} from "../../reqresp/types.js";

export type NativeProtocol = {
  id: NativeRequestProtocolId;
  method: ReqRespMethod;
  version: 1 | 2;
};

const applicationProtocols = [
  {method: ReqRespMethod.BeaconBlocksByRange, version: 2},
  {method: ReqRespMethod.BeaconBlocksByRoot, version: 2},
  {method: ReqRespMethod.BeaconBlocksByHead, version: 1},
  {method: ReqRespMethod.ExecutionPayloadEnvelopesByRange, version: 1},
  {method: ReqRespMethod.ExecutionPayloadEnvelopesByRoot, version: 1},
  {method: ReqRespMethod.InclusionListsByIndices, version: 1},
  {method: ReqRespMethod.DataColumnSidecarsByRange, version: 1},
  {method: ReqRespMethod.DataColumnSidecarsByRoot, version: 1},
  {method: ReqRespMethod.LightClientBootstrap, version: 1},
  {method: ReqRespMethod.LightClientUpdatesByRange, version: 1},
  {method: ReqRespMethod.LightClientFinalityUpdate, version: 1},
  {method: ReqRespMethod.LightClientOptimisticUpdate, version: 1},
] as const;

export const nativeProtocols: ReadonlyMap<string, NativeProtocol> = new Map(
  applicationProtocols.map(({method, version}) => {
    const id =
      version === 2
        ? (`/eth2/beacon_chain/req/${method}/2/ssz_snappy` as const)
        : (`/eth2/beacon_chain/req/${method}/1/ssz_snappy` as const);
    return [id, {id, method, version}];
  })
);
