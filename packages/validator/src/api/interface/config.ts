import {phase0} from "@chainsafe/lodestar-types";

export interface IConfigApi {
  getForkSchedule(): Promise<phase0.Fork[]>;
}
