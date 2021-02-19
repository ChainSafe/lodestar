import {IBeaconParams} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";

export interface IConfigApi {
  getForkSchedule(): Promise<phase0.Fork[]>;
  getDepositContract(): Promise<phase0.Contract>;
  getSpec(): Promise<IBeaconParams>;
}
