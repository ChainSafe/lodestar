import {ContainerType} from "@chainsafe/ssz";

import {IPhase0SSZTypes} from "../../phase0";
import * as lightclient from "../types";

export type ILightclientSSZTypes = Omit<
  IPhase0SSZTypes,
  "BeaconBlockBody" | "BeaconBlock" | "SignedBeaconBlock" | "BeaconState"
> & {
  // lightclient
  SyncCommittee: ContainerType<lightclient.SyncCommittee>;
  BeaconBlockBody: ContainerType<lightclient.BeaconBlockBody>;
  BeaconBlock: ContainerType<lightclient.BeaconBlock>;
  SignedBeaconBlock: ContainerType<lightclient.SignedBeaconBlock>;
  BeaconState: ContainerType<lightclient.BeaconState>;
  LightclientSnapshot: ContainerType<lightclient.LightclientSnapshot>;
  LightclientUpdate: ContainerType<lightclient.LightclientUpdate>;
  LightclientStore: ContainerType<lightclient.LightclientStore>;
};
