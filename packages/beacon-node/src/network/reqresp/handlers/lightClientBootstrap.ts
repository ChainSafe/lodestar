import {
  EncodedPayloadType,
  RespStatus,
  ResponseError,
  LightClientServerError,
  LightClientServerErrorCode,
  EncodedPayloadBytes,
  ContextBytesType,
  ProtocolDescriptor,
} from "@lodestar/reqresp";
import {Root, allForks} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientBootstrap(
  protocol: ProtocolDescriptor<Root, allForks.LightClientBootstrap>,
  requestBody: Root,
  chain: IBeaconChain
): AsyncIterable<EncodedPayloadBytes> {
  try {
    yield {
      type: EncodedPayloadType.bytes,
      bytes: protocol
        .responseType(chain.config.getForkName(chain.clock.currentSlot))
        .serialize(await chain.lightClientServer.getBootstrap(requestBody)),
      contextBytes: {
        type: ContextBytesType.ForkDigest,
        fork: chain.config.getForkName(chain.clock.currentSlot),
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
