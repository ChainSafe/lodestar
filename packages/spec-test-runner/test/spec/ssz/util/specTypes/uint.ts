import {BaseCase} from "@chainsafe/lodestar-spec-test-util";

export interface IUintCase extends BaseCase{
  value: string;
  ssz: string;
  type: string;
  valid: boolean;
}