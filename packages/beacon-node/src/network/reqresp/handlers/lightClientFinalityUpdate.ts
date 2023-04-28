import {
  ContextBytesType,
  EncodedPayloadBytes,
  EncodedPayloadType,
  ProtocolDescriptor,
  RespStatus,
  ResponseError,
} from "@lodestar/reqresp";
import {allForks} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientFinalityUpdate(
  protocol: ProtocolDescriptor<null, allForks.LightClientFinalityUpdate>,
  chain: IBeaconChain
): AsyncIterable<EncodedPayloadBytes> {
  const finalityUpdate = chain.lightClientServer.getFinalityUpdate();
  if (finalityUpdate === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest finality update available");
  } else {
    yield {
      type: EncodedPayloadType.bytes,
      bytes: protocol.responseType(chain.config.getForkName(chain.clock.currentSlot)).serialize(finalityUpdate),
      contextBytes: {
        type: ContextBytesType.ForkDigest,
        fork: chain.config.getForkName(chain.clock.currentSlot),
      },
    };
  }
}
