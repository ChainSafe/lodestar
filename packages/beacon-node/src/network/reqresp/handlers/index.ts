import {HandlerTypeFromMessage} from "@lodestar/reqresp";
import * as protocols from "@lodestar/reqresp/protocols";
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
  onStatus: HandlerTypeFromMessage<typeof protocols.Status>;
  onBeaconBlocksByRange: HandlerTypeFromMessage<typeof protocols.BeaconBlocksByRange>;
  onBeaconBlocksByRoot: HandlerTypeFromMessage<typeof protocols.BeaconBlocksByRoot>;
  onBeaconBlockAndBlobsSidecarByRoot: HandlerTypeFromMessage<typeof protocols.BeaconBlockAndBlobsSidecarByRoot>;
  onBlobsSidecarsByRange: HandlerTypeFromMessage<typeof protocols.BlobsSidecarsByRange>;
  onLightClientBootstrap: HandlerTypeFromMessage<typeof protocols.LightClientBootstrap>;
  onLightClientUpdatesByRange: HandlerTypeFromMessage<typeof protocols.LightClientUpdatesByRange>;
  onLightClientFinalityUpdate: HandlerTypeFromMessage<typeof protocols.LightClientFinalityUpdate>;
  onLightClientOptimisticUpdate: HandlerTypeFromMessage<typeof protocols.LightClientOptimisticUpdate>;
}
/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export function getReqRespHandlers({db, chain}: {db: IBeaconDb; chain: IBeaconChain}): ReqRespHandlers {
  return {
    async *onStatus(protocol) {
      yield* onStatus(protocol, chain);
    },
    async *onBeaconBlocksByRange(protocol, req) {
      yield* onBeaconBlocksByRange(protocol, req, chain, db);
    },
    async *onBeaconBlocksByRoot(protocol, req) {
      yield* onBeaconBlocksByRoot(protocol, req, chain, db);
    },
    async *onBeaconBlockAndBlobsSidecarByRoot(protocol, req) {
      yield* onBeaconBlockAndBlobsSidecarByRoot(protocol, req, chain, db);
    },
    async *onBlobsSidecarsByRange(protocol, req) {
      yield* onBlobsSidecarsByRange(protocol, req, chain, db);
    },
    async *onLightClientBootstrap(protocol, req) {
      yield* onLightClientBootstrap(protocol, req, chain);
    },
    async *onLightClientUpdatesByRange(protocol, req) {
      yield* onLightClientUpdatesByRange(protocol, req, chain);
    },
    async *onLightClientFinalityUpdate(protocol) {
      yield* onLightClientFinalityUpdate(protocol, chain);
    },
    async *onLightClientOptimisticUpdate(protocol) {
      yield* onLightClientOptimisticUpdate(protocol, chain);
    },
  };
}
