// Re-export union types for types that are _known_ to differ

import * as phase0 from "../phase0";
import * as altair from "../altair";
import * as phase1 from "../phase1";

export type BeaconBlockBody = phase0.BeaconBlockBody | altair.BeaconBlockBody | phase1.BeaconBlockBody;
export type BeaconBlock = phase0.BeaconBlock | altair.BeaconBlock | phase1.BeaconBlock;
export type SignedBeaconBlock = phase0.SignedBeaconBlock | altair.SignedBeaconBlock | phase1.SignedBeaconBlock;
export type BeaconState = phase0.BeaconState | altair.BeaconState | phase1.BeaconState;
