import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {ssz} from "@chainsafe/lodestar-types";
import {validateGossipAttestation} from "../../../../src/chain/validation";
import {generateTestCachedBeaconStateOnlyValidators} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {getAttestationValidData} from "../../../utils/validationData/attestation";

describe("validate gossip attestation", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 2 * 1000,
    runs: 1024,
  });

  const vc = 64;
  const stateSlot = 100;

  const {chain, attestation, subnet} = getAttestationValidData({
    currentSlot: stateSlot,
    state: generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot}),
  });

  const attStruct = attestation;
  const attTreeBacked = ssz.phase0.Attestation.createTreeBackedFromStruct(attStruct);

  itBench({
    id: "validate gossip attestation - struct",
    beforeEach: () => {
      chain.seenAttesters["validatorIndexesByEpoch"].clear();
    },
    fn: async () => {
      await validateGossipAttestation(chain, attStruct, subnet);
    },
  });

  itBench({
    id: "validate gossip attestation - treeBacked",
    beforeEach: () => {
      chain.seenAttesters["validatorIndexesByEpoch"].clear();
    },
    fn: async () => {
      await validateGossipAttestation(chain, attTreeBacked, subnet);
    },
  });
});
