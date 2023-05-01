import {ResponseOutgoing, RespStatus, ResponseError} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";
import {ReqRespMethod, responseSszTypeByMethod} from "../types.js";

export async function* onLightClientFinalityUpdate(chain: IBeaconChain): AsyncIterable<ResponseOutgoing> {
  const update = chain.lightClientServer.getFinalityUpdate();
  if (update === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest finality update available");
  } else {
    const fork = chain.config.getForkName(update.signatureSlot);
    const type = responseSszTypeByMethod[ReqRespMethod.LightClientFinalityUpdate](fork, 0);
    yield {
      data: type.serialize(update),
      fork,
    };
  }
}
