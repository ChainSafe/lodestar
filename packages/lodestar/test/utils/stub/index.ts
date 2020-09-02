import {SinonStubbedInstance} from "sinon";

import {ILMDGHOST, IBeaconChain, ChainEventEmitter} from "../../../src/chain";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";

interface IStubbedChain extends IBeaconChain {
  forkChoice: SinonStubbedInstance<ILMDGHOST>;
  epochCtx: SinonStubbedInstance<EpochContext> & EpochContext;
  emitter: SinonStubbedInstance<ChainEventEmitter>;
}

export type StubbedChain = IStubbedChain & SinonStubbedInstance<IBeaconChain>;

export * from "./beaconDb";
