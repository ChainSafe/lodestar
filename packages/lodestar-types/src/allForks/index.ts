// Re-export union types for types that are _known_ to differ

import * as phase0 from "../phase0";
import * as lightclient from "../lightclient";
import * as phase1 from "../phase1";

export type BeaconBlockBody = phase0.BeaconBlockBody | lightclient.BeaconBlockBody | phase1.BeaconBlockBody;
export type BeaconBlock = phase0.BeaconBlock | lightclient.BeaconBlock | phase1.BeaconBlock;
export type SignedBeaconBlock = phase0.SignedBeaconBlock | lightclient.SignedBeaconBlock | phase1.SignedBeaconBlock;
export type BeaconState = phase0.BeaconState | lightclient.BeaconState | phase1.BeaconState;
