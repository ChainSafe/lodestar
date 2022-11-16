import {allForks, altair, phase0, Root} from "@lodestar/types";
import {EncodedPayload, EncodedPayloadType} from "../types.js";
import {IBeaconChain, IBeaconDb} from "../sharedTypes.js";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange.js";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot.js";
import {onLightClientBootstrap} from "./lightClientBootstrap.js";
import {onLightClientUpdatesByRange} from "./lightClientUpdatesByRange.js";
import {onLightClientFinalityUpdate} from "./lightClientFinalityUpdate.js";
import {onLightClientOptimisticUpdate} from "./lightClientOptimisticUpdate.js";

export type ReqRespHandlers = {
  onStatus(): AsyncIterable<EncodedPayload<phase0.Status>>;
  onBeaconBlocksByRange(
    req: phase0.BeaconBlocksByRangeRequest
  ): AsyncIterable<EncodedPayload<allForks.SignedBeaconBlock>>;
  onBeaconBlocksByRoot(
    req: phase0.BeaconBlocksByRootRequest
  ): AsyncIterable<EncodedPayload<allForks.SignedBeaconBlock>>;
  onLightClientBootstrap(req: Root): AsyncIterable<EncodedPayload<altair.LightClientBootstrap>>;
  onLightClientUpdatesByRange(
    req: altair.LightClientUpdatesByRange
  ): AsyncIterable<EncodedPayload<altair.LightClientUpdate>>;
  onLightClientFinalityUpdate(): AsyncIterable<EncodedPayload<altair.LightClientFinalityUpdate>>;
  onLightClientOptimisticUpdate(): AsyncIterable<EncodedPayload<altair.LightClientOptimisticUpdate>>;
};

/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export function getReqRespHandlers({db, chain}: {db: IBeaconDb; chain: IBeaconChain}): ReqRespHandlers {
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
