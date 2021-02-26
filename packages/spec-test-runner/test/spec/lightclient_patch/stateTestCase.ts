import {lightclient} from "@chainsafe/lodestar-types";

export interface ILightclientStateTestCase {
  pre: lightclient.BeaconState;
  post: lightclient.BeaconState;
}
