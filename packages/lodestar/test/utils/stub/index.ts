import {SinonStubbedInstance} from "sinon";

import {ILMDGHOST, IBeaconChain} from "../../../src/chain";

export interface StubbedChain extends IBeaconChain {
  forkChoice: SinonStubbedInstance<ILMDGHOST>;
}

export * from "./beaconDb";
