import {ContainerType} from "@chainsafe/ssz";

import {PrimitiveSSZTypes} from "../primitive";
import * as phase0 from "../phase0";
import * as altair from "../altair";

// Re-export union types for types that are _known_ to differ

export type BeaconBlockBody = phase0.BeaconBlockBody | altair.BeaconBlockBody;
export type BeaconBlock = phase0.BeaconBlock | altair.BeaconBlock;
export type SignedBeaconBlock = phase0.SignedBeaconBlock | altair.SignedBeaconBlock;
export type BeaconState = phase0.BeaconState | altair.BeaconState;

// The difference between AllSSZTypes and AllForksSSZTypes:
// AllSSZTypes["BeaconState"] = ContainerType<phase0.BeaconState & altair.BeaconState & phase1.BeaconState>
// AllForksSSZTypes["BeaconState"] = ContainerType<phase0.BeaconState | altair.BeaconState | phase1.BeaconState>

type AllSSZTypes =
  | (PrimitiveSSZTypes & phase0.Phase0SSZTypes)
  | (PrimitiveSSZTypes & phase0.Phase0SSZTypes & altair.AltairSSZTypes);

export type AllForksSSZTypes = Omit<
  AllSSZTypes,
  "BeaconBlockBody" | "BeaconBlock" | "SignedBeaconBlock" | "BeaconState"
> & {
  BeaconBlockBody: ContainerType<BeaconBlockBody>;
  BeaconBlock: ContainerType<BeaconBlock>;
  SignedBeaconBlock: ContainerType<SignedBeaconBlock>;
  BeaconState: ContainerType<BeaconState>;
};
