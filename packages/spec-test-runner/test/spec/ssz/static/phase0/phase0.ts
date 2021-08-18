import {PresetName} from "@chainsafe/lodestar-params";
import {testStaticPhase0} from "../../util/testCases";

export function runSSZStaticSpecTest(preset: PresetName): void {
  for (const typeName of [
    "AggregateAndProof" as const,
    "AttestationData" as const,
    "Attestation" as const,
    "AttesterSlashing" as const,
    "BeaconBlockBody" as const,
    "BeaconBlockHeader" as const,
    "BeaconBlock" as const,
    "BeaconState" as const,
    "Checkpoint" as const,
    "DepositMessage" as const,
    "DepositData" as const,
    "Deposit" as const,
    "Eth1Data" as const,
    "Fork" as const,
    "HistoricalBatch" as const,
    "IndexedAttestation" as const,
    "PendingAttestation" as const,
    "ProposerSlashing" as const,
    "SignedBeaconBlock" as const,
    "SignedBeaconBlockHeader" as const,
    "SignedVoluntaryExit" as const,
    "SigningData" as const,
    "Validator" as const,
    "VoluntaryExit" as const,
  ]) {
    testStaticPhase0(typeName, preset);
  }
}
