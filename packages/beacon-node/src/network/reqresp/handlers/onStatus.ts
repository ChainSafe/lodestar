import {EncodedPayload, EncodedPayloadType} from "@lodestar/reqresp";
import {phase0} from "@lodestar/types";

export async function* onStatus(
  _request: phase0.BeaconBlocksByRangeRequest
): AsyncIterable<EncodedPayload<phase0.Status>> {
  yield {type: EncodedPayloadType.ssz, data: chain.getStatus()};
}
