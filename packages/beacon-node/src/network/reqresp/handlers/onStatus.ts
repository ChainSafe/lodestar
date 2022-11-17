import {EncodedPayload, EncodedPayloadType} from "@lodestar/reqresp";
import {phase0} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onStatus(chain: IBeaconChain): AsyncIterable<EncodedPayload<phase0.Status>> {
  yield {type: EncodedPayloadType.ssz, data: chain.getStatus()};
}
