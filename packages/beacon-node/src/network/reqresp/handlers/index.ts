import {PeerId} from "@libp2p/interface-peer-id";
import {phase0, ssz} from "@lodestar/types";
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
    async *onBeaconBlocksByRange(req) {
      const body = ssz.phase0.BeaconBlocksByRangeRequest.deserialize(req.data);
      yield* onBeaconBlocksByRange(body, chain, db);
    },
    async *onBeaconBlocksByRoot(req) {
      const body = ssz.phase0.BeaconBlocksByRootRequest.deserialize(req.data);
      yield* onBeaconBlocksByRoot(body, chain, db);
    },
    async *onBeaconBlockAndBlobsSidecarByRoot(req) {
      const body = ssz.deneb.BeaconBlockAndBlobsSidecarByRootRequest.deserialize(req.data);
      yield* onBeaconBlockAndBlobsSidecarByRoot(body, chain, db);
    },
    async *onBlobsSidecarsByRange(req) {
      const body = ssz.deneb.BlobsSidecarsByRangeRequest.deserialize(req.data);
      yield* onBlobsSidecarsByRange(body, chain, db);
    },
    async *onLightClientBootstrap(req) {
      const body = ssz.Root.deserialize(req.data);
      yield* onLightClientBootstrap(body, chain);
    },
    async *onLightClientUpdatesByRange(req) {
      const body = ssz.altair.LightClientUpdatesByRange.deserialize(req.data);
      yield* onLightClientUpdatesByRange(body, chain);
    },
    async *onLightClientFinalityUpdate() {
      yield* onLightClientFinalityUpdate(chain);
    },
    async *onLightClientOptimisticUpdate() {
      yield* onLightClientOptimisticUpdate(chain);
    },
  };
}
