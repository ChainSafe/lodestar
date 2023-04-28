import {ContextBytesType, EncodedPayloadBytes, EncodedPayloadType, ProtocolDescriptor} from "@lodestar/reqresp";
import {phase0} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onStatus(
  protocol: ProtocolDescriptor<phase0.Status, phase0.Status>,
  chain: IBeaconChain
): AsyncIterable<EncodedPayloadBytes> {
  yield {
    type: EncodedPayloadType.bytes,
    bytes: protocol.responseType(chain.config.getForkName(chain.clock.currentSlot)).serialize(chain.getStatus()),
    contextBytes: {type: ContextBytesType.Empty},
  };
}
