import {ResponseOutgoing, ResponseError, RespStatus, ProtocolDescriptor} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientOptimisticUpdate(
  protocol: ProtocolDescriptor,
  chain: IBeaconChain
): AsyncIterable<ResponseOutgoing> {
  const update = chain.lightClientServer.getOptimisticUpdate();
  if (update === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest optimistic update available");
  } else {
    const fork = chain.config.getForkName(update.signatureSlot);
    yield {
      data: protocol.responseEncoder(fork).serialize(update),
      fork,
    };
  }
}
