import {
  LightClientServerError,
  LightClientServerErrorCode,
  RespStatus,
  ResponseError,
  ResponseOutgoing,
} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Root} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {assertLightClientServerEnabled} from "../../../node/utils/lightclient.js";

export async function* onLightClientBootstrap(requestBody: Root, chain: IBeaconChain): AsyncIterable<ResponseOutgoing> {
  assertLightClientServerEnabled(chain.opts.disableLightClientServer);

  try {
    const bootstrap = await chain.beaconEngine.getLightClientBootstrap(requestBody);
    const boundary = chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(bootstrap.slot));
    yield {
      data: bootstrap.data,
      boundary,
    };
  } catch (e) {
    if ((e as LightClientServerError).type?.code === LightClientServerErrorCode.RESOURCE_UNAVAILABLE) {
      throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
    }
    throw new ResponseError(RespStatus.SERVER_ERROR, (e as Error).message);
  }
}
