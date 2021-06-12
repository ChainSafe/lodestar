import {PresetName} from "@chainsafe/lodestar-params";
import {testStaticPhase0} from "../../util/testCases";

export function runSSZStaticSpecTest(preset: PresetName): void {
  // phase0
  testStaticPhase0("AggregateAndProof", preset);
  testStaticPhase0("AttestationData", preset);
  testStaticPhase0("Attestation", preset);
  testStaticPhase0("AttesterSlashing", preset);
  testStaticPhase0("BeaconBlockBody", preset);
  testStaticPhase0("BeaconBlockHeader", preset);
  testStaticPhase0("BeaconBlock", preset);
  testStaticPhase0("BeaconState", preset);
  testStaticPhase0("Checkpoint", preset);
  testStaticPhase0("DepositMessage", preset);
  testStaticPhase0("DepositData", preset);
  testStaticPhase0("Deposit", preset);
  testStaticPhase0("Eth1Data", preset);
  testStaticPhase0("Fork", preset);
  testStaticPhase0("HistoricalBatch", preset);
  testStaticPhase0("IndexedAttestation", preset);
  testStaticPhase0("PendingAttestation", preset);
  testStaticPhase0("ProposerSlashing", preset);
  testStaticPhase0("SignedBeaconBlock", preset);
  testStaticPhase0("SignedBeaconBlockHeader", preset);
  testStaticPhase0("SignedVoluntaryExit", preset);
  testStaticPhase0("SigningData", preset);
  testStaticPhase0("Validator", preset);
  testStaticPhase0("VoluntaryExit", preset);
}
