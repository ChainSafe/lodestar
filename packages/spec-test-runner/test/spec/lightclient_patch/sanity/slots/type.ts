import {lightclient, Uint64} from "@chainsafe/lodestar-types";

export interface IProcessSlotsTestCase {
  pre: lightclient.BeaconState;
  post?: lightclient.BeaconState;
  slots: Uint64;
}
