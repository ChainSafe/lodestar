import {testStaticAltair, testStaticPhase0} from "../util/testCases";

// phase0
testStaticPhase0("AggregateAndProof");
testStaticPhase0("AttestationData");
testStaticPhase0("Attestation");
testStaticPhase0("AttesterSlashing");
testStaticPhase0("BeaconBlockBody");
testStaticPhase0("BeaconBlockHeader");
testStaticPhase0("BeaconBlock");
testStaticPhase0("BeaconState");
testStaticPhase0("Checkpoint");
testStaticPhase0("DepositMessage");
testStaticPhase0("DepositData");
testStaticPhase0("Deposit");
testStaticPhase0("Eth1Data");
testStaticPhase0("Fork");
testStaticPhase0("HistoricalBatch");
testStaticPhase0("IndexedAttestation");
testStaticPhase0("PendingAttestation");
testStaticPhase0("ProposerSlashing");
testStaticPhase0("SignedBeaconBlock");
testStaticPhase0("SignedBeaconBlockHeader");
testStaticPhase0("SignedVoluntaryExit");
testStaticPhase0("SigningData");
testStaticPhase0("Validator");
testStaticPhase0("VoluntaryExit");

// altair
// TODO: fix this
// testStaticAltair("BeaconBlock");
// testStaticAltair("SyncAggregate");
testStaticAltair("SyncCommittee");
