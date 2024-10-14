import {
  RespStatus,
  ResponseError,
  LightClientServerError,
  LightClientServerErrorCode,
  ResponseOutgoing,
} from "@lodestar/reqresp";
import {Root} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {ReqRespMethod, responseSszTypeByMethod} from "../types.js";
import {assertLightClientServer} from "../../../node/utils/lightclient.js";

export async function* onLightClientBootstrap(requestBody: Root, chain: IBeaconChain): AsyncIterable<ResponseOutgoing> {
  assertLightClientServer(chain.lightClientServer);

  try {
    const bootstrap = await chain.lightClientServer.getBootstrap(requestBody);
    const fork = chain.config.getForkName(bootstrap.header.beacon.slot);
    const type = responseSszTypeByMethod[ReqRespMethod.LightClientBootstrap](fork, 0);
    yield {
      data: type.serialize(bootstrap),
      fork,
    };
  } catch (e) {
    if ((e as LightClientServerError).type?.code === LightClientServerErrorCode.RESOURCE_UNAVAILABLE) {
      throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
    }
    throw new ResponseError(RespStatus.SERVER_ERROR, (e as Error).message);
  }
}
