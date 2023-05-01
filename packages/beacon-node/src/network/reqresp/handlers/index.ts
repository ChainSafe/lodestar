import {ssz} from "@lodestar/types";
import {ProtocolHandler} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {ReqRespMethod} from "../types.js";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange.js";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot.js";
import {onBeaconBlockAndBlobsSidecarByRoot} from "./beaconBlockAndBlobsSidecarByRoot.js";
import {onBlobsSidecarsByRange} from "./blobsSidecarsByRange.js";
import {onLightClientBootstrap} from "./lightClientBootstrap.js";
import {onLightClientFinalityUpdate} from "./lightClientFinalityUpdate.js";
import {onLightClientOptimisticUpdate} from "./lightClientOptimisticUpdate.js";
import {onLightClientUpdatesByRange} from "./lightClientUpdatesByRange.js";

export type ReqRespHandlers = Partial<Record<ReqRespMethod, ProtocolHandler>>;

/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export function getReqRespHandlers({db, chain}: {db: IBeaconDb; chain: IBeaconChain}): ReqRespHandlers {
  return {
    async *[ReqRespMethod.BeaconBlocksByRange](req) {
      const body = ssz.phase0.BeaconBlocksByRangeRequest.deserialize(req.data);
      yield* onBeaconBlocksByRange(body, chain, db);
    },
    async *[ReqRespMethod.BeaconBlocksByRoot](req) {
      const body = ssz.phase0.BeaconBlocksByRootRequest.deserialize(req.data);
      yield* onBeaconBlocksByRoot(body, chain, db);
    },
    async *[ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot](req) {
      const body = ssz.deneb.BeaconBlockAndBlobsSidecarByRootRequest.deserialize(req.data);
      yield* onBeaconBlockAndBlobsSidecarByRoot(body, chain, db);
    },
    async *[ReqRespMethod.BlobsSidecarsByRange](req) {
      const body = ssz.deneb.BlobsSidecarsByRangeRequest.deserialize(req.data);
      yield* onBlobsSidecarsByRange(body, chain, db);
    },
    async *[ReqRespMethod.LightClientBootstrap](req) {
      const body = ssz.Root.deserialize(req.data);
      yield* onLightClientBootstrap(body, chain);
    },
    async *[ReqRespMethod.LightClientUpdatesByRange](req) {
      const body = ssz.altair.LightClientUpdatesByRange.deserialize(req.data);
      yield* onLightClientUpdatesByRange(body, chain);
    },
    async *[ReqRespMethod.LightClientFinalityUpdate]() {
      yield* onLightClientFinalityUpdate(chain);
    },
    async *[ReqRespMethod.LightClientOptimisticUpdate]() {
      yield* onLightClientOptimisticUpdate(chain);
    },
  };
}
