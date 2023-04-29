import {
  ContextBytesType,
  OutgoingPayload,
  OutgoingPayloadBytes,
  PayloadType,
  ProtocolDescriptor,
  ResponseError,
  RespStatus,
} from "@lodestar/reqresp";
import {allForks} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientOptimisticUpdate(
  protocol: ProtocolDescriptor<null, allForks.LightClientOptimisticUpdate>,
  chain: IBeaconChain
): AsyncIterable<OutgoingPayloadBytes> {
  const optimisticUpdate = chain.lightClientServer.getOptimisticUpdate();
  if (optimisticUpdate === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest optimistic update available");
  } else {
    const fork = chain.config.getForkName(chain.clock.currentSlot);
    yield {
      type: PayloadType.bytes,
      bytes: protocol.responseEncoder(fork).serialize(optimisticUpdate),
      contextBytes: {
        type: ContextBytesType.ForkDigest,
        fork,
      },
    };
  }
}
