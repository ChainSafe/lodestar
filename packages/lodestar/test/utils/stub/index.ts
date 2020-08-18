import {SinonStubbedInstance} from "sinon";

import {ILMDGHOST, IBeaconChain} from "../../../src/chain";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";

interface IStubbedChain extends IBeaconChain {
  forkChoice: SinonStubbedInstance<ILMDGHOST>;
  epochCtx: SinonStubbedInstance<EpochContext> & EpochContext;
}

export type StubbedChain = IStubbedChain & SinonStubbedInstance<IBeaconChain>;

export * from "./beaconDb";
