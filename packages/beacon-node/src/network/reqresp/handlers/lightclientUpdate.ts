import {altair} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightclientUpdate(
  requestBody: altair.LightClientUpdateByRange,
  chain: IBeaconChain
): AsyncIterable<altair.LightClientUpdate[]> {
  yield await chain.lightClientServer.getUpdates(requestBody.startPeriod, requestBody.count);
}
