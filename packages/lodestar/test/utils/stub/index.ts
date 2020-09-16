import {SinonStubbedInstance} from "sinon";

import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain, ChainEventEmitter} from "../../../src/chain";

interface IStubbedChain extends IBeaconChain {
  forkChoice: SinonStubbedInstance<ForkChoice> & ForkChoice;
  epochCtx: SinonStubbedInstance<EpochContext> & EpochContext;
  emitter: SinonStubbedInstance<ChainEventEmitter>;
}

export type StubbedChain = IStubbedChain & SinonStubbedInstance<IBeaconChain>;

export * from "./beaconDb";
