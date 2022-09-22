import {altair, phase0} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {ReqRespBlockResponse} from "../types.js";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange.js";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot.js";
import {onLightclientBootstrap} from "./lightClientBootstrap.js";
import {onLightclientUpdate} from "./lightClientUpdate.js";
import {onLightClientFinalityUpdate} from "./lightClientFinalityUpdate.js";
import {onLightClientOptimisticUpdate} from "./lightClientOptimisticUpdate.js";

export type ReqRespHandlers = {
  onStatus(): AsyncIterable<phase0.Status>;
  onBeaconBlocksByRange(req: phase0.BeaconBlocksByRangeRequest): AsyncIterable<ReqRespBlockResponse>;
  onBeaconBlocksByRoot(req: phase0.BeaconBlocksByRootRequest): AsyncIterable<ReqRespBlockResponse>;
  onLightClientBootstrap(req: altair.BlockRoot): AsyncIterable<altair.LightClientBootstrap>;
  onLightClientUpdate(req: altair.LightClientUpdateByRange): AsyncIterable<altair.LightClientUpdate[]>;
  onLightClientFinalityUpdate(): AsyncIterable<altair.LightClientFinalityUpdate>;
  onLightClientOptimisticUpdate(): AsyncIterable<altair.LightClientOptimisticUpdate>;
};

/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export function getReqRespHandlers({db, chain}: {db: IBeaconDb; chain: IBeaconChain}): ReqRespHandlers {
  return {
    async *onStatus() {
      yield chain.getStatus();
    },
    async *onBeaconBlocksByRange(req) {
      yield* onBeaconBlocksByRange(req, chain, db);
    },
    async *onBeaconBlocksByRoot(req) {
      yield* onBeaconBlocksByRoot(req, chain, db);
    },
    async *onLightClientBootstrap(req) {
      yield* onLightclientBootstrap(req, chain);
    },
    async *onLightClientUpdate(req) {
      yield* onLightclientUpdate(req, chain);
    },
    async *onLightClientFinalityUpdate() {
      yield* onLightClientFinalityUpdate(chain);
    },
    async *onLightClientOptimisticUpdate() {
      yield* onLightClientOptimisticUpdate(chain);
    },
  };
}
