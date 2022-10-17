import {altair} from "@lodestar/types";
import {MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightclientUpdate(
  requestBody: altair.LightClientUpdatesByRange,
  chain: IBeaconChain
): AsyncIterable<altair.LightClientUpdate> {
  const count = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, requestBody.count);
  yield* await chain.lightClientServer.getUpdates(requestBody.startPeriod, count);
}
