import {SinonStubbedInstance} from "sinon";

import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain, ChainEventEmitter} from "../../../src/chain";

interface IStubbedChain extends IBeaconChain {
  forkChoice: SinonStubbedInstance<IForkChoice>;
  epochCtx: SinonStubbedInstance<phase0.EpochContext> & phase0.EpochContext;
  emitter: SinonStubbedInstance<ChainEventEmitter>;
}

export type StubbedChain = IStubbedChain & SinonStubbedInstance<IBeaconChain>;

export * from "./chain";
export * from "./beaconDb";
