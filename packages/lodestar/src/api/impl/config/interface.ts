import {IBeaconParams} from "@chainsafe/lodestar-params";
import {Fork, Contract} from "@chainsafe/lodestar-types";

export interface IConfigApi {
  getForkSchedule(): Fork[];
  getDepositContract(): Contract;
  getSpec(): IBeaconParams;
}
