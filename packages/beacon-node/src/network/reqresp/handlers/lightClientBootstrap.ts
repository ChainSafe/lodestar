import {
  RespStatus,
  ResponseError,
  LightClientServerError,
  LightClientServerErrorCode,
  ResponseOutgoing,
  ProtocolDescriptor,
} from "@lodestar/reqresp";
import {Root} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientBootstrap(
  protocol: ProtocolDescriptor,
  requestBody: Root,
  chain: IBeaconChain
): AsyncIterable<ResponseOutgoing> {
  try {
    const bootstrap = await chain.lightClientServer.getBootstrap(requestBody);
    const fork = chain.config.getForkName(bootstrap.header.beacon.slot);
    yield {
      data: protocol.responseEncoder(fork).serialize(bootstrap),
      fork,
    };
  } catch (e) {
    if ((e as LightClientServerError).type?.code === LightClientServerErrorCode.RESOURCE_UNAVAILABLE) {
      throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
    } else {
      throw new ResponseError(RespStatus.SERVER_ERROR, (e as Error).message);
    }
  }
}
