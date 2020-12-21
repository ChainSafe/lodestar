import {ContainerType} from "@chainsafe/ssz";
import * as t from "./types";

export interface ILightclientSSZTypes {
  SyncCommittee: ContainerType<t.SyncCommittee>;
  BeaconBlock: ContainerType<t.BeaconBlock>;
  BeaconBlockHeader: ContainerType<t.BeaconBlockHeader>;
  BeaconState: ContainerType<t.BeaconState>;
  LightclientSnapshot: ContainerType<t.LightclientSnapshot>;
  LightclientUpdate: ContainerType<t.LightclientUpdate>;
  LightclientStore: ContainerType<t.LightclientStore>;
}
