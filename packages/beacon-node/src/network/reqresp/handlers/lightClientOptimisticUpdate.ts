import {
  ContextBytesType,
  EncodedPayloadBytes,
  EncodedPayloadType,
  ProtocolDescriptor,
  ResponseError,
  RespStatus,
} from "@lodestar/reqresp";
import {allForks} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientOptimisticUpdate(
  protocol: ProtocolDescriptor<null, allForks.LightClientOptimisticUpdate>,
  chain: IBeaconChain
): AsyncIterable<EncodedPayloadBytes> {
  const optimisticUpdate = chain.lightClientServer.getOptimisticUpdate();
  if (optimisticUpdate === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest optimistic update available");
  } else {
    yield {
      type: EncodedPayloadType.bytes,
      bytes: protocol.responseType(chain.config.getForkName(chain.clock.currentSlot)).serialize(optimisticUpdate),
      contextBytes: {
        type: ContextBytesType.ForkDigest,
        fork: chain.config.getForkName(chain.clock.currentSlot),
      },
    };
  }
}
