import {ForkName} from "@lodestar/params";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {sszTypesFor} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onStatus(chain: IBeaconChain): AsyncIterable<ResponseOutgoing> {
  const status = chain.getStatus();
  const fork = chain.config.getForkName(chain.clock.currentSlot);
  yield {
    data: sszTypesFor(fork).Status.serialize(status),
    // Status topic is fork-agnostic
    boundary: {fork: ForkName.phase0},
  };
}
