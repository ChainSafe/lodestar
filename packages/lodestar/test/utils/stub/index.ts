import {SinonStubbedInstance} from "sinon";

import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {IBeaconChain, ChainEventEmitter} from "../../../src/chain";

interface IStubbedChain extends IBeaconChain {
  forkChoice: SinonStubbedInstance<IForkChoice>;
  emitter: SinonStubbedInstance<ChainEventEmitter>;
}

export type StubbedChain = IStubbedChain & SinonStubbedInstance<IBeaconChain>;

export * from "./beaconDb";
