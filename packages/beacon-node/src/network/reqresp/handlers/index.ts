import {PeerId} from "@libp2p/interface-peer-id";
import {Root, altair, deneb, phase0, ssz} from "@lodestar/types";
import {ProtocolHandler, ResponseOutgoing} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange.js";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot.js";
import {onBeaconBlockAndBlobsSidecarByRoot} from "./beaconBlockAndBlobsSidecarByRoot.js";
import {onBlobsSidecarsByRange} from "./blobsSidecarsByRange.js";
import {onLightClientBootstrap} from "./lightClientBootstrap.js";
import {onLightClientFinalityUpdate} from "./lightClientFinalityUpdate.js";
import {onLightClientOptimisticUpdate} from "./lightClientOptimisticUpdate.js";
import {onLightClientUpdatesByRange} from "./lightClientUpdatesByRange.js";
import {onStatus} from "./status.js";

export interface ReqRespHandlers {
  onStatus: (req: phase0.Status, peerId: PeerId) => AsyncIterable<ResponseOutgoing>;
  onBeaconBlocksByRange: ProtocolHandler;
  onBeaconBlocksByRoot: ProtocolHandler;
  onBeaconBlockAndBlobsSidecarByRoot: ProtocolHandler;
  onBlobsSidecarsByRange: ProtocolHandler;
  onLightClientBootstrap: ProtocolHandler;
  onLightClientUpdatesByRange: ProtocolHandler;
  onLightClientFinalityUpdate: ProtocolHandler;
  onLightClientOptimisticUpdate: ProtocolHandler;
}
/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export function getReqRespHandlers({db, chain}: {db: IBeaconDb; chain: IBeaconChain}): ReqRespHandlers {
  return {
    async *onStatus() {
      yield* onStatus(chain);
    },
    async *onBeaconBlocksByRange(protocol, req) {
      const body = protocol.requestEncoder?.deserialize(req.data) as phase0.BeaconBlocksByRangeRequest;
      yield* onBeaconBlocksByRange(protocol, body, chain, db);
    },
    async *onBeaconBlocksByRoot(protocol, req) {
      const body = protocol.requestEncoder?.deserialize(req.data) as phase0.BeaconBlocksByRootRequest;
      yield* onBeaconBlocksByRoot(protocol, body, chain, db);
    },
    async *onBeaconBlockAndBlobsSidecarByRoot(protocol, req) {
      const body = protocol.requestEncoder?.deserialize(req.data) as phase0.BeaconBlocksByRootRequest;
      yield* onBeaconBlockAndBlobsSidecarByRoot(protocol, body, chain, db);
    },
    async *onBlobsSidecarsByRange(protocol, req) {
      const body = protocol.requestEncoder?.deserialize(req.data) as deneb.BlobsSidecarsByRangeRequest;
      yield* onBlobsSidecarsByRange(protocol, body, chain, db);
    },
    async *onLightClientBootstrap(protocol, req) {
      const body = protocol.requestEncoder?.deserialize(req.data) as Root;
      yield* onLightClientBootstrap(protocol, body, chain);
    },
    async *onLightClientUpdatesByRange(protocol, req) {
      const body = protocol.requestEncoder?.deserialize(req.data) as altair.LightClientUpdatesByRange;
      yield* onLightClientUpdatesByRange(protocol, body, chain);
    },
    async *onLightClientFinalityUpdate(protocol) {
      yield* onLightClientFinalityUpdate(protocol, chain);
    },
    async *onLightClientOptimisticUpdate(protocol) {
      yield* onLightClientOptimisticUpdate(protocol, chain);
    },
  };
}
