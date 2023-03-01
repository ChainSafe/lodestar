import {
  EncodedPayload,
  EncodedPayloadType,
  RespStatus,
  ResponseError,
  LightClientServerError,
  LightClientServerErrorCode,
} from "@lodestar/reqresp";
import {Root, allForks} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientBootstrap(
  requestBody: Root,
  chain: IBeaconChain
): AsyncIterable<EncodedPayload<allForks.LightClientBootstrap>> {
  try {
    yield {
      type: EncodedPayloadType.ssz,
      data: await chain.lightClientServer.getBootstrap(requestBody),
    };
  } catch (e) {
    if ((e as LightClientServerError).type?.code === LightClientServerErrorCode.RESOURCE_UNAVAILABLE) {
      throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
    } else {
      throw new ResponseError(RespStatus.SERVER_ERROR, (e as Error).message);
    }
  }
}
