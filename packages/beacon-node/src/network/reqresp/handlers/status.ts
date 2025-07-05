import {ForkName, GENESIS_EPOCH} from "@lodestar/params";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {ssz} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onStatus(chain: IBeaconChain): AsyncIterable<ResponseOutgoing> {
  const status = chain.getStatus();
  yield {
    data: ssz.phase0.Status.serialize(status),
    // Status topic is fork-agnostic
    boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH},
  };
}
