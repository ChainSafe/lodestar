import {ProtocolHandler} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {
  BeaconBlocksByRootRequestType,
  BlobSidecarsByRootRequestType,
  DataColumnSidecarsByRootRequestType,
  ExecutionPayloadEnvelopesByRootRequestType,
} from "../../../util/types.js";
import {GetReqRespHandlerFn, ReqRespMethod} from "../types.js";
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
      const body = ssz.phase0.BeaconBlocksByRangeRequest.deserialize(req.data);
      return onBeaconBlocksByRange(body, chain, db, peerId, peerClient);
    },
    [ReqRespMethod.BeaconBlocksByRoot]: (req) => {
      const fork = chain.config.getForkName(chain.clock.currentSlot);
      const body = BeaconBlocksByRootRequestType(fork, chain.config).deserialize(req.data);
      return onBeaconBlocksByRoot(body, chain);
    },
    [ReqRespMethod.BlobSidecarsByRoot]: (req) => {
      const fork = chain.config.getForkName(chain.clock.currentSlot);
      const body = BlobSidecarsByRootRequestType(fork, chain.config).deserialize(req.data);
      return onBlobSidecarsByRoot(body, chain);
    },
    [ReqRespMethod.BlobSidecarsByRange]: (req) => {
      const body = ssz.deneb.BlobSidecarsByRangeRequest.deserialize(req.data);
      return onBlobSidecarsByRange(body, chain, db);
    },
    [ReqRespMethod.DataColumnSidecarsByRange]: (req, peerId, peerClient) => {
      const body = ssz.fulu.DataColumnSidecarsByRangeRequest.deserialize(req.data);
      return onDataColumnSidecarsByRange(body, chain, db, peerId, peerClient);
    },
    [ReqRespMethod.DataColumnSidecarsByRoot]: (req, peerId, peerClient) => {
      const body = DataColumnSidecarsByRootRequestType(chain.config).deserialize(req.data);
      return onDataColumnSidecarsByRoot(body, chain, db, peerId, peerClient);
    },

    [ReqRespMethod.ExecutionPayloadEnvelopesByRoot]: (req) => {
      const body = ExecutionPayloadEnvelopesByRootRequestType(chain.config).deserialize(req.data);
      return onExecutionPayloadEnvelopesByRoot(body, chain, db);
    },
    [ReqRespMethod.ExecutionPayloadEnvelopesByRange]: (req) => {
      const body = ssz.gloas.ExecutionPayloadEnvelopesByRangeRequest.deserialize(req.data);
      return onExecutionPayloadEnvelopesByRange(body, chain, db);
    },

    [ReqRespMethod.LightClientBootstrap]: (req) => {
      const body = ssz.Root.deserialize(req.data);
      return onLightClientBootstrap(body, chain);
    },
    [ReqRespMethod.LightClientUpdatesByRange]: (req) => {
      const body = ssz.altair.LightClientUpdatesByRange.deserialize(req.data);
      return onLightClientUpdatesByRange(body, chain);
    },
    [ReqRespMethod.LightClientFinalityUpdate]: () => onLightClientFinalityUpdate(chain),
    [ReqRespMethod.LightClientOptimisticUpdate]: () => onLightClientOptimisticUpdate(chain),

    // EIP-8025: Execution proof req/resp handlers
    [ReqRespMethod.ExecutionProofsByRoot]: (req) => {
      const body = ssz.eip8025.ExecutionProofsByRootRequest.deserialize(req.data);
      // TODO EIP-8025: ExecutionProofsByRootRequest should use requestRoot per spec
      const proofs = chain.executionProofPool.getByRequestRootHex(toRootHex(body.blockRoot));
      return (async function* () {
        for (const proof of proofs) {
          yield {
            data: ssz.eip8025.SignedExecutionProof.serialize(proof),
            boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(chain.clock.currentSlot)),
          };
        }
      })();
    },
    [ReqRespMethod.ExecutionProofsByRange]: (_req) => {
      // Pool no longer has slot-based indexing; return all proofs
      // TODO EIP-8025: Add slot-based filtering or update protocol
      const proofs = chain.executionProofPool.getAll();
      return (async function* () {
        for (const proof of proofs) {
          yield {
            data: ssz.eip8025.SignedExecutionProof.serialize(proof),
            boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(chain.clock.currentSlot)),
          };
        }
      })();
    },
  };

  return (method) => handlers[method];
}
