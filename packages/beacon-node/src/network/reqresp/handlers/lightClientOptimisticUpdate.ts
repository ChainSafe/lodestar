import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {IBeaconChain} from "../../../chain/index.js";
import {assertLightClientServer} from "../../../node/utils/lightclient.js";
import {ReqRespMethod, responseSszTypeByMethod} from "../types.js";

export async function* onLightClientOptimisticUpdate(chain: IBeaconChain): AsyncIterable<ResponseOutgoing> {
  assertLightClientServer(chain.lightClientServer);

  const update = chain.lightClientServer.getOptimisticUpdate();
  if (update === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest optimistic update available");
  }

  const boundary = chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(update.signatureSlot));
  const type = responseSszTypeByMethod[ReqRespMethod.LightClientOptimisticUpdate](boundary.fork, 0);
  yield {
    data: type.serialize(update),
    boundary,
  };
}
