import {SinonStubbedInstance} from "sinon";

import {IBeaconDb} from "../../src/db";
import {OpPool} from "../../src/opPool";
import {ILMDGHOST, IBeaconChain} from "../../src/chain";

export type StubbedBeaconDb = {
  [P in keyof IBeaconDb]: SinonStubbedInstance<IBeaconDb[P]>;
} & IBeaconDb;

export type StubbedOpPool = {
  [P in keyof OpPool]: SinonStubbedInstance<OpPool[P]>;
} & OpPool;

export interface StubbedChain extends IBeaconChain {
  forkChoice: SinonStubbedInstance<ILMDGHOST>;
}
