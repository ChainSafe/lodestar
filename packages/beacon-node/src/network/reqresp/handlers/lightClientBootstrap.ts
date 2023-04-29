import {
  PayloadType,
  RespStatus,
  ResponseError,
  LightClientServerError,
  LightClientServerErrorCode,
  IncomingPayload,
  OutgoingPayloadBytes,
  ProtocolDescriptor,
  ContextBytesType,
} from "@lodestar/reqresp";
import {Root, allForks} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientBootstrap(
  protocol: ProtocolDescriptor<Root, allForks.LightClientBootstrap>,
  request: IncomingPayload<Root>,
  chain: IBeaconChain
): AsyncIterable<OutgoingPayloadBytes> {
  const requestBody =
    request.type === PayloadType.ssz
      ? request.data
      : protocol.requestEncoder(chain.config.getForkName(chain.clock.currentSlot))?.deserialize(request.bytes);

  if (!requestBody) {
    throw new Error(`Invalid request for method=${protocol.method}, version=${protocol.version}`);
  }

  try {
    const fork = chain.config.getForkName(chain.clock.currentSlot);

    yield {
      type: PayloadType.bytes,
      bytes: protocol.responseEncoder(fork).serialize(await chain.lightClientServer.getBootstrap(requestBody)),
      contextBytes: {
        type: ContextBytesType.ForkDigest,
        fork,
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
