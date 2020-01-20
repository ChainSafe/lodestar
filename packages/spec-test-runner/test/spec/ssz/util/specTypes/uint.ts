import {BaseCase} from "@chainsafe/eth2.0-spec-test-util";

export interface IUintCase extends BaseCase{
  value: string;
  ssz: string;
  type: string;
  valid: boolean;
}