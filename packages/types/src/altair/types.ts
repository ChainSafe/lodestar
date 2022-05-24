import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type SyncSubnets = ValueOf<typeof ssz.SyncSubnets>;
export type Metadata = ValueOf<typeof ssz.Metadata>;
export type SyncCommittee = ValueOf<typeof ssz.SyncCommittee>;
export type SyncCommitteeMessage = ValueOf<typeof ssz.SyncCommitteeMessage>;
export type SyncCommitteeContribution = ValueOf<typeof ssz.SyncCommitteeContribution>;
export type ContributionAndProof = ValueOf<typeof ssz.ContributionAndProof>;
export type SignedContributionAndProof = ValueOf<typeof ssz.SignedContributionAndProof>;
export type SyncAggregatorSelectionData = ValueOf<typeof ssz.SyncAggregatorSelectionData>;
export type SyncAggregate = ValueOf<typeof ssz.SyncAggregate>;
export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BeaconState = ValueOf<typeof ssz.BeaconState>;
export type LightClientSnapshot = ValueOf<typeof ssz.LightClientSnapshot>;
export type LightClientUpdate = ValueOf<typeof ssz.LightClientUpdate>;
export type LightClientStore = ValueOf<typeof ssz.LightClientStore>;
