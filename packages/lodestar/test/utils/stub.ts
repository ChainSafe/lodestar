import {SinonStubbedInstance} from "sinon";

import {IBeaconDb} from "../../src/db";
import {ILMDGHOST, IBeaconChain} from "../../src/chain";

export type StubbedBeaconDb = {
  [P in keyof IBeaconDb]: SinonStubbedInstance<IBeaconDb[P]>;
} & IBeaconDb;

export interface StubbedChain extends IBeaconChain {
  forkChoice: SinonStubbedInstance<ILMDGHOST>;
}
