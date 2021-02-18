/* eslint-disable @typescript-eslint/naming-convention */
/**
 * @module params
 */

import {IPhase0Params} from "./phase0";

export type IBeaconParams = IPhase0Params & {
  // Old and future forks
  ALL_FORKS: IFork[];
};

interface IFork {
  // 4 bytes
  previousVersion: number;
  // 4 bytes
  currentVersion: number;
  // Fork epoch number
  epoch: number;
}
