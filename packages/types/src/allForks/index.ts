import {ContainerType} from "@chainsafe/ssz";

import * as phase0 from "../phase0";
import * as altair from "../altair";

// Re-export union types for types that are _known_ to differ

export type BeaconBlockBody = phase0.BeaconBlockBody | altair.BeaconBlockBody;
export type BeaconBlock = phase0.BeaconBlock | altair.BeaconBlock;
export type SignedBeaconBlock = phase0.SignedBeaconBlock | altair.SignedBeaconBlock;
export type BeaconState = phase0.BeaconState | altair.BeaconState;

// The difference between IAllSSZTypes and IAllForksSSZTypes:
// IAllSSZTypes["BeaconState"] = ContainerType<phase0.BeaconState & altair.BeaconState & phase1.BeaconState>
// IAllForksSSZTypes["BeaconState"] = ContainerType<phase0.BeaconState | altair.BeaconState | phase1.BeaconState>

type IAllSSZTypes = phase0.IPhase0SSZTypes | altair.IAltairSSZTypes;

export type IAllForksSSZTypes = Omit<
  IAllSSZTypes,
  "BeaconBlockBody" | "BeaconBlock" | "SignedBeaconBlock" | "BeaconState"
> & {
  BeaconBlockBody: ContainerType<BeaconBlockBody>;
  BeaconBlock: ContainerType<BeaconBlock>;
  SignedBeaconBlock: ContainerType<SignedBeaconBlock>;
  BeaconState: ContainerType<BeaconState>;
};
