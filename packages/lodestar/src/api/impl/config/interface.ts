import {Fork, Contract} from "@chainsafe/lodestar-types";

export interface IConfigApi {
  getForkSchedule(): Fork[];
  getDepositContract(): Contract;
}
