import {IBaseCase} from "@chainsafe/lodestar-spec-test-util";

export interface IGenesisInitCase extends IBaseCase {
  state: any;
  eth1BlockHash: any;
  eth1Timestamp: any;
  deposits: any;
}

export interface IGenesisValidityCase extends IBaseCase {
  genesis: any;
  isValid: true;
}
