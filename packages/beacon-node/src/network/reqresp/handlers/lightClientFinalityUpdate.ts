import {
  ResponseError,
  RespStatus,
  PayloadType,
  ProtocolDescriptor,
  OutgoingPayloadBytes,
  ContextBytesType,
} from "@lodestar/reqresp";
import {allForks} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientFinalityUpdate(
  protocol: ProtocolDescriptor<null, allForks.LightClientFinalityUpdate>,
  chain: IBeaconChain
): AsyncIterable<OutgoingPayloadBytes> {
  const finalityUpdate = chain.lightClientServer.getFinalityUpdate();
  if (finalityUpdate === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest finality update available");
  } else {
    const fork = chain.config.getForkName(chain.clock.currentSlot);

    yield {
      type: PayloadType.bytes,
      bytes: protocol.responseEncoder(fork).serialize(finalityUpdate),
      contextBytes: {
        type: ContextBytesType.ForkDigest,
        fork,
      },
    };
  }
}
