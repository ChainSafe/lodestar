import {ResponseOutgoing} from "@lodestar/reqresp";
import {ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onStatus(chain: IBeaconChain): AsyncIterable<ResponseOutgoing> {
  const status = chain.getStatus();
  yield {
    data: ssz.phase0.Status.serialize(status),
    // Status topic is fork-agnostic
    fork: ForkName.phase0,
  };
}
