import {ssz} from "@lodestar/types";
import {ProtocolHandler} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {GetReqRespHandlerFn, ReqRespMethod} from "../types.js";
import {onBeaconBlocksByRange} from "./beacon_blocks_by_range.js";
import {onBeaconBlocksByRoot} from "./beacon_blocks_by_root.js";
import {onBlobSidecarsByRoot} from "./blob_sidecars_by_root.js.js";
import {onBlobSidecarsByRange} from "./blob_sidecars_by_range.js";
import {onLightClientBootstrap} from "./light_client_bootstrap.js";
import {onLightClientFinalityUpdate} from "./light_client_finality_update.js";
import {onLightClientOptimisticUpdate} from "./light_client_optimistic_update.js";
import {onLightClientUpdatesByRange} from "./light_client_updates_by_range.js";

function notImplemented(method: ReqRespMethod): ProtocolHandler {
  return () => {
    throw Error(`Handler not implemented for ${method}`);
  };
}

/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export function getReqRespHandlers({db, chain}: {db: IBeaconDb; chain: IBeaconChain}): GetReqRespHandlerFn {
  const handlers: Record<ReqRespMethod, ProtocolHandler> = {
    [ReqRespMethod.Status]: notImplemented(ReqRespMethod.Status),
    [ReqRespMethod.Goodbye]: notImplemented(ReqRespMethod.Goodbye),
    [ReqRespMethod.Ping]: notImplemented(ReqRespMethod.Ping),
    [ReqRespMethod.Metadata]: notImplemented(ReqRespMethod.Metadata),
    [ReqRespMethod.BeaconBlocksByRange]: (req) => {
      const body = ssz.phase0.BeaconBlocksByRangeRequest.deserialize(req.data);
      return onBeaconBlocksByRange(body, chain, db);
    },
    [ReqRespMethod.BeaconBlocksByRoot]: (req) => {
      const body = ssz.phase0.BeaconBlocksByRootRequest.deserialize(req.data);
      return onBeaconBlocksByRoot(body, chain, db);
    },
    [ReqRespMethod.BlobSidecarsByRoot]: (req) => {
      const body = ssz.deneb.BlobSidecarsByRootRequest.deserialize(req.data);
      return onBlobSidecarsByRoot(body, chain, db);
    },
    [ReqRespMethod.BlobSidecarsByRange]: (req) => {
      const body = ssz.deneb.BlobSidecarsByRangeRequest.deserialize(req.data);
      return onBlobSidecarsByRange(body, chain, db);
    },
    [ReqRespMethod.LightClientBootstrap]: (req) => {
      const body = ssz.Root.deserialize(req.data);
      return onLightClientBootstrap(body, chain);
    },
    [ReqRespMethod.LightClientUpdatesByRange]: (req) => {
      const body = ssz.altair.LightClientUpdatesByRange.deserialize(req.data);
      return onLightClientUpdatesByRange(body, chain);
    },
    [ReqRespMethod.LightClientFinalityUpdate]: () => onLightClientFinalityUpdate(chain),
    [ReqRespMethod.LightClientOptimisticUpdate]: () => onLightClientOptimisticUpdate(chain),
  };

  return (method) => handlers[method];
}
