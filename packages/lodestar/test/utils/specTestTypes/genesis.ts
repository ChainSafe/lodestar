import {BaseCase} from "@chainsafe/eth2.0-spec-test-util";

export interface GenesisInitCase extends BaseCase {
  state: any;
  eth1BlockHash: any;
  eth1Timestamp: any;
  deposits: any;
}

export interface GenesisValidityCase extends BaseCase {
  genesis: any;
  isValid: true;
}