import {altair} from "@lodestar/types";
import {MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightclientUpdate(
  requestBody: altair.LightClientUpdatesByRange,
  chain: IBeaconChain
): AsyncIterable<altair.LightClientUpdate> {
  const count = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, requestBody.count);
  for (const period of Array.from({length: count}, (_ignored, i) => i + requestBody.startPeriod)) {
    yield await chain.lightClientServer.getUpdate(period);
  }
}
