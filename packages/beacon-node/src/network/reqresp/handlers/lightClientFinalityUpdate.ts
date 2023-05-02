import {ResponseOutgoing, RespStatus, ResponseError, ProtocolDescriptor} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientFinalityUpdate(
  protocol: ProtocolDescriptor,
  chain: IBeaconChain
): AsyncIterable<ResponseOutgoing> {
  const update = chain.lightClientServer.getFinalityUpdate();
  if (update === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest finality update available");
  } else {
    const fork = chain.config.getForkName(update.signatureSlot);
    yield {
      data: protocol.responseEncoder(fork).serialize(update),
      fork,
    };
  }
}
