import {beaconRestApiServerOpts, BeaconRestApiServerOpts} from "./rest/index.js";

export type ApiOptions = {
  maxGindicesInProof?: number;
  rest: BeaconRestApiServerOpts;
  version?: string;
};

export const defaultApiOptions: ApiOptions = {
  maxGindicesInProof: 512,
  rest: beaconRestApiServerOpts,
  version: "dev",
};
