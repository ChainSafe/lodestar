import {
  EncodedPayload,
  EncodedPayloadType,
  RespStatus,
  ResponseError,
  LightClientServerError,
  LightClientServerErrorCode,
  EncodedPayloadBytes,
  ContextBytesType,
} from "@lodestar/reqresp";
import {Root, ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientBootstrap(
  requestBody: Root,
  chain: IBeaconChain
): AsyncIterable<EncodedPayloadBytes> {
  try {
    yield {
      type: EncodedPayloadType.bytes,
      bytes: ssz.altair.LightClientBootstrap.serialize(await chain.lightClientServer.getBootstrap(requestBody)),
      contextBytes: {
        type: ContextBytesType.ForkDigest,
        fork: ForkName.altair,
      },
    };
  } catch (e) {
    if ((e as LightClientServerError).type?.code === LightClientServerErrorCode.RESOURCE_UNAVAILABLE) {
      throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
    } else {
      throw new ResponseError(RespStatus.SERVER_ERROR, (e as Error).message);
    }
  }
}
