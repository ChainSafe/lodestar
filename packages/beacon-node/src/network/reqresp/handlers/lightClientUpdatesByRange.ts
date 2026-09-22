import {MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {
  LightClientServerError,
  LightClientServerErrorCode,
  RespStatus,
  ResponseError,
  ResponseOutgoing,
} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {altair} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {assertLightClientServer} from "../../../node/utils/lightclient.js";
import {ReqRespMethod, responseSszTypeByMethod} from "../types.js";

export async function* onLightClientUpdatesByRange(
  requestBody: altair.LightClientUpdatesByRange,
  chain: IBeaconChain
): AsyncIterable<ResponseOutgoing> {
  assertLightClientServer(chain.lightClientServer);

  const count = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, requestBody.count);
  if (!Number.isSafeInteger(requestBody.startPeriod)) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startPeriod out of range");
  }
  let started = false;
  for (let i = 0; i < count; i++) {
    const period = requestBody.startPeriod + i;
    try {
      const update = await chain.lightClientServer.getUpdate(period);
      const boundary = chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(update.attestedHeader.beacon.slot));
      const type = responseSszTypeByMethod[ReqRespMethod.LightClientUpdatesByRange](boundary.fork, 0);

      yield {
        data: type.serialize(update),
        boundary,
      };
      started = true;
    } catch (e) {
      if ((e as LightClientServerError).type?.code === LightClientServerErrorCode.RESOURCE_UNAVAILABLE) {
        // Period not available, if we already started yielding, stop to
        // preserve consecutive order. Otherwise skip leading gaps.
        if (started) return;
        continue;
      }
      throw new ResponseError(RespStatus.SERVER_ERROR, (e as Error).message);
    }
  }
}
