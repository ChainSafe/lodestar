import {ResponseOutgoing, ResponseError, RespStatus} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";
import {ReqRespMethod, responseSszTypeByMethod} from "../types.js";

export async function* onLightClientOptimisticUpdate(chain: IBeaconChain): AsyncIterable<ResponseOutgoing> {
  const update = chain.lightClientServer.getOptimisticUpdate();
  if (update === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest optimistic update available");
  } else {
    const fork = chain.config.getForkName(update.signatureSlot);
    const type = responseSszTypeByMethod[ReqRespMethod.LightClientOptimisticUpdate](fork, 0);
    yield {
      data: type.serialize(update),
      fork,
    };
  }
}
