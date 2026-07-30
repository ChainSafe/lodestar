import type {Type} from "@chainsafe/ssz";
import {ProtocolHandler, RespStatus, ResponseError} from "@lodestar/reqresp";
import {ssz} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {
  BeaconBlocksByRootRequestType,
  BlobSidecarsByRootRequestType,
  DataColumnSidecarsByRootRequestType,
  ExecutionPayloadEnvelopesByRootRequestType,
} from "../../../util/types.js";
import {GetReqRespHandlerFn, ReqRespMethod} from "../types.js";
import {onBeaconBlocksByHead} from "./beaconBlocksByHead.js";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange.js";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot.js";
import {onBlobSidecarsByRange} from "./blobSidecarsByRange.js";
import {onBlobSidecarsByRoot} from "./blobSidecarsByRoot.js";
import {onDataColumnSidecarsByRange} from "./dataColumnSidecarsByRange.js";
import {onDataColumnSidecarsByRoot} from "./dataColumnSidecarsByRoot.js";
import {onExecutionPayloadEnvelopesByRange} from "./executionPayloadEnvelopesByRange.js";
import {onExecutionPayloadEnvelopesByRoot} from "./executionPayloadEnvelopesByRoot.js";
import {onLightClientBootstrap} from "./lightClientBootstrap.js";
import {onLightClientFinalityUpdate} from "./lightClientFinalityUpdate.js";
import {onLightClientOptimisticUpdate} from "./lightClientOptimisticUpdate.js";
import {onLightClientUpdatesByRange} from "./lightClientUpdatesByRange.js";

function notImplemented(method: ReqRespMethod): ProtocolHandler {
  return () => {
    throw Error(`Handler not implemented for ${method}`);
  };
}

function deserializeRequestBody<T>(type: Type<T>, data: Uint8Array): T {
  try {
    return type.deserialize(data);
  } catch (e) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, e instanceof Error ? e.message : String(e));
  }
}

/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export function getReqRespHandlers({db, chain}: {db: IBeaconDb; chain: IBeaconChain}): GetReqRespHandlerFn {
  const handlers: Record<ReqRespMethod, ProtocolHandler> = {
    [ReqRespMethod.Status]: notImplemented(ReqRespMethod.Status),
    [ReqRespMethod.Goodbye]: notImplemented(ReqRespMethod.Goodbye),
    [ReqRespMethod.Ping]: notImplemented(ReqRespMethod.Ping),
    [ReqRespMethod.Metadata]: notImplemented(ReqRespMethod.Metadata),
    [ReqRespMethod.BeaconBlocksByRange]: (req, peerId, peerClient) => {
      const body = deserializeRequestBody(ssz.phase0.BeaconBlocksByRangeRequest, req.data);
      return onBeaconBlocksByRange(body, chain, db, peerId, peerClient);
    },
    [ReqRespMethod.BeaconBlocksByRoot]: (req) => {
      const fork = chain.config.getForkName(chain.clock.currentSlot);
      const body = deserializeRequestBody(BeaconBlocksByRootRequestType(fork, chain.config), req.data);
      return onBeaconBlocksByRoot(body, chain);
    },
    [ReqRespMethod.BeaconBlocksByHead]: (req, peerId, peerClient) => {
      const body = deserializeRequestBody(ssz.fulu.BeaconBlocksByHeadRequest, req.data);
      return onBeaconBlocksByHead(body, chain, peerId, peerClient);
    },
    [ReqRespMethod.BlobSidecarsByRoot]: (req) => {
      const fork = chain.config.getForkName(chain.clock.currentSlot);
      const body = deserializeRequestBody(BlobSidecarsByRootRequestType(fork, chain.config), req.data);
      return onBlobSidecarsByRoot(body, chain);
    },
    [ReqRespMethod.BlobSidecarsByRange]: (req) => {
      const body = deserializeRequestBody(ssz.deneb.BlobSidecarsByRangeRequest, req.data);
      return onBlobSidecarsByRange(body, chain, db);
    },
    [ReqRespMethod.DataColumnSidecarsByRange]: (req, peerId, peerClient) => {
      const body = deserializeRequestBody(ssz.fulu.DataColumnSidecarsByRangeRequest, req.data);
      return onDataColumnSidecarsByRange(body, chain, db, peerId, peerClient);
    },
    [ReqRespMethod.DataColumnSidecarsByRoot]: (req, peerId, peerClient) => {
      const body = deserializeRequestBody(DataColumnSidecarsByRootRequestType(chain.config), req.data);
      return onDataColumnSidecarsByRoot(body, chain, db, peerId, peerClient);
    },

    [ReqRespMethod.ExecutionPayloadEnvelopesByRoot]: (req, peerId, peerClient) => {
      const body = deserializeRequestBody(ExecutionPayloadEnvelopesByRootRequestType(chain.config), req.data);
      return onExecutionPayloadEnvelopesByRoot(body, chain, db, peerId, peerClient);
    },
    [ReqRespMethod.ExecutionPayloadEnvelopesByRange]: (req, peerId, peerClient) => {
      const body = deserializeRequestBody(ssz.gloas.ExecutionPayloadEnvelopesByRangeRequest, req.data);
      return onExecutionPayloadEnvelopesByRange(body, chain, db, peerId, peerClient);
    },

    [ReqRespMethod.LightClientBootstrap]: (req) => {
      const body = deserializeRequestBody(ssz.Root, req.data);
      return onLightClientBootstrap(body, chain);
    },
    [ReqRespMethod.LightClientUpdatesByRange]: (req) => {
      const body = deserializeRequestBody(ssz.altair.LightClientUpdatesByRange, req.data);
      return onLightClientUpdatesByRange(body, chain);
    },
    [ReqRespMethod.LightClientFinalityUpdate]: () => onLightClientFinalityUpdate(chain),
    [ReqRespMethod.LightClientOptimisticUpdate]: () => onLightClientOptimisticUpdate(chain),
  };

  return (method) => handlers[method];
}
