import {IBaseCase} from "@chainsafe/lodestar-spec-test-util";

export interface IUintCase extends IBaseCase {
  value: string;
  ssz: string;
  type: string;
  valid: boolean;
}
