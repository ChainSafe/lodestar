import {beaconRestApiServerOpts, BeaconRestApiServerOpts} from "./rest/index.js";

export interface IApiOptions {
  maxGindicesInProof?: number;
  rest: BeaconRestApiServerOpts;
  version?: string;
}

export const defaultApiOptions: IApiOptions = {
  maxGindicesInProof: 512,
  rest: beaconRestApiServerOpts,
  version: "dev",
};
