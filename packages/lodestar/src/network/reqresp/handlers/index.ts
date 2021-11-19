import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";
import {ReqRespBlockResponse} from "../types";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot";

export type ReqRespHandlers = {
  onStatus(): AsyncIterable<phase0.Status>;
  onBeaconBlocksByRange(req: phase0.BeaconBlocksByRangeRequest): AsyncIterable<ReqRespBlockResponse>;
  onBeaconBlocksByRoot(req: phase0.BeaconBlocksByRootRequest): AsyncIterable<ReqRespBlockResponse>;
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
  };
}
