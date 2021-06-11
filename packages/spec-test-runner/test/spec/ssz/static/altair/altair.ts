import {ForkName, PresetName} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {testStaticAltair} from "../../util/testCases";

export function runSSZStaticSpecTest(preset: PresetName): void {
  // phase0
  for (const typeName of [
    "AggregateAndProof",
    "AttestationData",
    "Attestation",
    "AttesterSlashing",
    "BeaconBlockHeader",
    "Checkpoint",
    "DepositMessage",
    "DepositData",
    "Deposit",
    "Eth1Data",
    "Fork",
    "ForkData",
    "HistoricalBatch",
    "IndexedAttestation",
    "PendingAttestation",
    "ProposerSlashing",
    "SignedAggregateAndProof",
    "SignedBeaconBlockHeader",
    "SignedVoluntaryExit",
    "SigningData",
    "Validator",
    "VoluntaryExit",
  ]) {
    testStaticAltair({fork: ForkName.phase0, type: typeName as keyof typeof ssz["phase0"]}, preset);
  }

  // altair
  for (const typeName of [
    "BeaconBlock",
    "BeaconBlockBody",
    "BeaconState",
    "ContributionAndProof",
    "LightClientSnapshot",
    "LightClientUpdate",
    "SignedBeaconBlock",
    "SignedContributionAndProof",
    "SyncAggregate",
    "SyncAggregatorSelectionData",
    "SyncCommittee",
    "SyncCommitteeContribution",
    "SyncCommitteeSignature",
  ]) {
    testStaticAltair({fork: ForkName.altair, type: typeName as keyof typeof ssz["altair"]}, preset);
  }
}
