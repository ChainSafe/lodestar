import {ContainerType} from "@chainsafe/ssz";

import * as phase0 from "../phase0";
import * as altair from "../altair";

// Re-export union types for types that are _known_ to differ

export type BeaconBlockBody = phase0.BeaconBlockBody | altair.BeaconBlockBody;
export type BeaconBlock = phase0.BeaconBlock | altair.BeaconBlock;
export type SignedBeaconBlock = phase0.SignedBeaconBlock | altair.SignedBeaconBlock;
export type BeaconState = phase0.BeaconState | altair.BeaconState;
export type Metadata = phase0.Metadata | altair.Metadata;

/**
 * SSZ Types known to change between forks
 */
export type AllForksSSZTypes = {
  BeaconBlockBody: ContainerType<BeaconBlockBody>;
  BeaconBlock: ContainerType<BeaconBlock>;
  SignedBeaconBlock: ContainerType<SignedBeaconBlock>;
  BeaconState: ContainerType<BeaconState>;
  Metadata: ContainerType<Metadata>;
};
