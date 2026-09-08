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
import {ServingContext, isServingCapacityError} from "../../../chain/serving/context.js";
import {serializeServingValue} from "../../../chain/serving/serialization.js";
import {assertLightClientServer} from "../../../node/utils/lightclient.js";
import {ReqRespMethod, responseSszTypeByMethod} from "../types.js";

export async function* onLightClientBootstrap(
  requestBody: Root,
  chain: IBeaconChain,
  context?: ServingContext
): AsyncIterable<ResponseOutgoing> {
  assertLightClientServer(chain.lightClientServer);

  try {
    const bootstrap = await chain.lightClientServer.getBootstrap(requestBody, context);
    const boundary = chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(bootstrap.header.beacon.slot));
    const type = responseSszTypeByMethod[ReqRespMethod.LightClientBootstrap](boundary.fork, 0);
    yield {
      data: context
        ? serializeServingValue(type, bootstrap, context, Math.min(type.maxSize, chain.config.MAX_PAYLOAD_SIZE))
        : type.serialize(bootstrap),
      boundary,
    };
  } catch (e) {
    if (isServingCapacityError(e)) throw e;
    if ((e as LightClientServerError).type?.code === LightClientServerErrorCode.RESOURCE_UNAVAILABLE) {
      throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
    }
    throw new ResponseError(RespStatus.SERVER_ERROR, (e as Error).message);
  }
}
