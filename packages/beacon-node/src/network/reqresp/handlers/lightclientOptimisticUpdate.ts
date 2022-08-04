import {altair} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {ResponseError} from "../response/index.js";
import {RespStatus} from "../../../constants/index.js";

export async function* onLightClientOptimisticUpdate(
  chain: IBeaconChain
): AsyncIterable<altair.LightClientOptimisticUpdate> {
  try {
    yield await chain.lightClientServer.getOptimisticUpdate();
  } catch (e) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
  }
}
