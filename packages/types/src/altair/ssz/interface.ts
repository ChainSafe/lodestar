import {ContainerType} from "@chainsafe/ssz";

import {IPhase0SSZTypes} from "../../phase0";
import * as altair from "../types";

export type ILightclientSSZTypes = Omit<
  IPhase0SSZTypes,
  "BeaconBlockBody" | "BeaconBlock" | "SignedBeaconBlock" | "BeaconState"
> & {
  // altair
  SyncCommittee: ContainerType<altair.SyncCommittee>;
  BeaconBlockBody: ContainerType<altair.BeaconBlockBody>;
  BeaconBlock: ContainerType<altair.BeaconBlock>;
  SignedBeaconBlock: ContainerType<altair.SignedBeaconBlock>;
  BeaconState: ContainerType<altair.BeaconState>;
  LightclientSnapshot: ContainerType<altair.LightclientSnapshot>;
  LightclientUpdate: ContainerType<altair.LightclientUpdate>;
  LightclientStore: ContainerType<altair.LightclientStore>;
};
