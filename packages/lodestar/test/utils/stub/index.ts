import {SinonStubbedInstance} from "sinon";

import {ILMDGHOST, IBeaconChain} from "../../../src/chain";

interface IStubbedChain extends IBeaconChain {
  forkChoice: SinonStubbedInstance<ILMDGHOST>;
}

export type StubbedChain = IStubbedChain & SinonStubbedInstance<IBeaconChain>;

export * from "./beaconDb";
