import {ForkName, ForkSeq} from "@lodestar/params";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {fulu, ssz} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onStatus(chain: IBeaconChain): AsyncIterable<ResponseOutgoing> {
  const status = chain.getStatus();
  const forkSeq = chain.config.getForkSeq(chain.clock.currentSlot);
  yield {
    data:
      forkSeq >= ForkSeq.fulu ? ssz.fulu.Status.serialize(status as fulu.Status) : ssz.phase0.Status.serialize(status),
    // Status topic is fork-agnostic
    fork: ForkName.phase0,
  };
}
