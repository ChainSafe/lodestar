import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type ts = {
  SyncSubnets: ValueOf<typeof ssz.SyncSubnets>;
  Metadata: ValueOf<typeof ssz.Metadata>;
  SyncCommittee: ValueOf<typeof ssz.SyncCommittee>;
  SyncCommitteeMessage: ValueOf<typeof ssz.SyncCommitteeMessage>;
  SyncCommitteeContribution: ValueOf<typeof ssz.SyncCommitteeContribution>;
  ContributionAndProof: ValueOf<typeof ssz.ContributionAndProof>;
  SignedContributionAndProof: ValueOf<typeof ssz.SignedContributionAndProof>;
  SyncAggregatorSelectionData: ValueOf<typeof ssz.SyncAggregatorSelectionData>;
  SyncAggregate: ValueOf<typeof ssz.SyncAggregate>;
  BeaconBlockBody: ValueOf<typeof ssz.BeaconBlockBody>;
  BeaconBlock: ValueOf<typeof ssz.BeaconBlock>;
  SignedBeaconBlock: ValueOf<typeof ssz.SignedBeaconBlock>;
  BeaconState: ValueOf<typeof ssz.BeaconState>;

  LightClientHeader: ValueOf<typeof ssz.LightClientHeader>;
  LightClientBootstrap: ValueOf<typeof ssz.LightClientBootstrap>;
  LightClientUpdate: ValueOf<typeof ssz.LightClientUpdate>;
  LightClientFinalityUpdate: ValueOf<typeof ssz.LightClientFinalityUpdate>;
  LightClientOptimisticUpdate: ValueOf<typeof ssz.LightClientOptimisticUpdate>;
  LightClientStore: ValueOf<typeof ssz.LightClientStore>;
  LightClientUpdatesByRange: ValueOf<typeof ssz.LightClientUpdatesByRange>;
};
