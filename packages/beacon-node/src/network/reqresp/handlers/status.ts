import {ContextBytesType, OutgoingPayloadBytes, PayloadType, ProtocolDescriptor} from "@lodestar/reqresp";
import {phase0} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onStatus(
  protocol: ProtocolDescriptor<phase0.Status, phase0.Status>,
  chain: IBeaconChain
): AsyncIterable<OutgoingPayloadBytes> {
  yield {
    type: PayloadType.bytes,
    bytes: protocol.responseEncoder(chain.config.getForkName(chain.clock.currentSlot)).serialize(chain.getStatus()),
    contextBytes: {type: ContextBytesType.Empty},
  };
}
