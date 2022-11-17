import {HandlerTypeFromMessage} from "@lodestar/reqresp";
import messages from "@lodestar/reqresp/messages";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange.js";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot.js";
import {onLightClientBootstrap} from "./lightClientBootstrap.js";
import {onLightClientFinalityUpdate} from "./lightClientFinalityUpdate.js";
import {onLightClientOptimisticUpdate} from "./lightClientOptimisticUpdate.js";
import {onLightClientUpdatesByRange} from "./lightClientUpdatesByRange.js";
import {onStatus} from "./onStatus.js";

export type ReqRespHandlers = ReturnType<typeof getReqRespHandlers>;
/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export function getReqRespHandlers({
  db,
  chain,
}: {
  db: IBeaconDb;
  chain: IBeaconChain;
}): {
  onStatus: HandlerTypeFromMessage<typeof messages.v1.Status>;
  onBeaconBlocksByRange: HandlerTypeFromMessage<typeof messages.v1.BeaconBlocksByRange>;
  onBeaconBlocksByRoot: HandlerTypeFromMessage<typeof messages.v1.BeaconBlocksByRoot>;
  onLightClientBootstrap: HandlerTypeFromMessage<typeof messages.v1.LightClientBootstrap>;
  onLightClientUpdatesByRange: HandlerTypeFromMessage<typeof messages.v1.LightClientUpdatesByRange>;
  onLightClientFinalityUpdate: HandlerTypeFromMessage<typeof messages.v1.LightClientFinalityUpdate>;
  onLightClientOptimisticUpdate: HandlerTypeFromMessage<typeof messages.v1.LightClientOptimisticUpdate>;
} {
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
