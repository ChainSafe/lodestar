import {EncodedPayloadType, Handler} from "@lodestar/reqresp";
import {phase0} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange.js";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot.js";
import {onLightClientBootstrap} from "./lightClientBootstrap.js";
import {onLightClientFinalityUpdate} from "./lightClientFinalityUpdate.js";
import {onLightClientOptimisticUpdate} from "./lightClientOptimisticUpdate.js";
import {onLightClientUpdatesByRange} from "./lightClientUpdatesByRange.js";

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
}): {onStatus: Handler<phase0.Status, phase0.Status>} {
  return {
    async *onStatus() {
      yield {type: EncodedPayloadType.ssz, data: chain.getStatus()};
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
