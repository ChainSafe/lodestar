import {Fork} from "@chainsafe/lodestar-types";

export interface IConfigApi {
  getForkSchedule(): Promise<Fork[]>;
}
