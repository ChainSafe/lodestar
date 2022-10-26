import {altair, Root} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {ResponseError} from "../response/index.js";
import {RespStatus} from "../../../constants/index.js";

export async function* onLightClientBootstrap(
  requestBody: Root,
  chain: IBeaconChain
): AsyncIterable<altair.LightClientBootstrap> {
  try {
    yield await chain.lightClientServer.getBootstrap(requestBody);
  } catch (e) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
  }
}
