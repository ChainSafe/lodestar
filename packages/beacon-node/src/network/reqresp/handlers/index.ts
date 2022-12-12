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
    async *onStatus() {
      yield* onStatus(chain);
    },
    async *onBeaconBlocksByRange(req) {
      yield* onBeaconBlocksByRange(req, chain, db);
    },
    async *onBeaconBlocksByRoot(req) {
      yield* onBeaconBlocksByRoot(req, chain, db);
    },
    async *onBeaconBlockAndBlobsSidecarByRoot(req) {
      yield* onBeaconBlockAndBlobsSidecarByRoot(req, chain, db);
    },
    async *onBlobsSidecarsByRange(req) {
      yield* onBlobsSidecarsByRange(req, chain, db);
    },
    async *onLightClientBootstrap(req) {
      yield* onLightClientBootstrap(req, chain);
    },
    async *onLightClientUpdatesByRange(req) {
      yield* onLightClientUpdatesByRange(req, chain);
    },
    async *onLightClientFinalityUpdate() {
      yield* onLightClientFinalityUpdate(chain);
    },
    async *onLightClientOptimisticUpdate() {
      yield* onLightClientOptimisticUpdate(chain);
    },
  };
}
