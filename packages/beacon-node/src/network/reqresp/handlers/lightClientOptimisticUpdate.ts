import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {IBeaconChain} from "../../../chain/index.js";
import {ServingContext} from "../../../chain/serving/context.js";
import {serializeServingValue} from "../../../chain/serving/serialization.js";
import {assertLightClientServer} from "../../../node/utils/lightclient.js";
import {ReqRespMethod, responseSszTypeByMethod} from "../types.js";

export async function* onLightClientOptimisticUpdate(
  chain: IBeaconChain,
  context?: ServingContext
): AsyncIterable<ResponseOutgoing> {
  assertLightClientServer(chain.lightClientServer);

  const response = (() => {
    const update = chain.lightClientServer.getOptimisticUpdate();
    if (update === null) {
      throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest optimistic update available");
    }

    const boundary = chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(update.attestedHeader.beacon.slot));
    const type = responseSszTypeByMethod[ReqRespMethod.LightClientOptimisticUpdate](boundary.fork, 0);
    return {
      data: context
        ? serializeServingValue(type, update, context, Math.min(type.maxSize, chain.config.MAX_PAYLOAD_SIZE))
        : type.serialize(update),
      boundary,
    };
  })();
  yield response;
}
