import {IBeaconParams} from "@chainsafe/lodestar-params";
import {Fork, Contract} from "@chainsafe/lodestar-types";

export interface IConfigApi {
  getForkSchedule(): Promise<Fork[]>;
  getDepositContract(): Promise<Contract>;
  getSpec(): Promise<IBeaconParams>;
}
