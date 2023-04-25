import {ContextBytesType, EncodedPayloadBytes, EncodedPayloadType} from "@lodestar/reqresp";
import {ssz} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onStatus(chain: IBeaconChain): AsyncIterable<EncodedPayloadBytes> {
  yield {
    type: EncodedPayloadType.bytes,
    bytes: ssz.phase0.Status.serialize(chain.getStatus()),
    contextBytes: {type: ContextBytesType.Empty},
  };
}
