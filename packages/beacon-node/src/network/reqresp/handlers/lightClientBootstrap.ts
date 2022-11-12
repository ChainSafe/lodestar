import {altair, Root} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {ResponseError} from "../response/index.js";
import {RespStatus} from "../../../constants/index.js";
import {LightClientServerError, LightClientServerErrorCode} from "../../../chain/errors/lightClientError.js";
import {EncodedPayload, EncodedPayloadType} from "../types.js";

export async function* onLightClientBootstrap(
  requestBody: Root,
  chain: IBeaconChain
): AsyncIterable<EncodedPayload<altair.LightClientBootstrap>> {
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
