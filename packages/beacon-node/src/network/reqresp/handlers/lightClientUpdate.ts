import {altair} from "@lodestar/types";
import {MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientUpdate(
  requestBody: altair.LightClientUpdatesByRange,
  chain: IBeaconChain
): AsyncIterable<altair.LightClientUpdate> {
  const count = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, requestBody.count);
  for (let period = requestBody.startPeriod; period < requestBody.startPeriod + count; period++) {
    yield await chain.lightClientServer.getUpdate(period);
  }
}
