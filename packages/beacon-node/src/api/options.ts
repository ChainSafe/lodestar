import {BeaconRestApiServerOpts, beaconRestApiServerOpts} from "./rest/index.js";

export type ApiOptions = {
  maxGindicesInProof?: number;
  /** Broadcast execution payload bids submitted via the API without running gossip validation */
  disableBidValidation?: boolean;
  rest: BeaconRestApiServerOpts;
  commit?: string;
  version?: string;
  private?: boolean;
};

export const defaultApiOptions: ApiOptions = {
  maxGindicesInProof: 512,
  disableBidValidation: false,
  rest: beaconRestApiServerOpts,
  version: "dev",
  private: false,
};
