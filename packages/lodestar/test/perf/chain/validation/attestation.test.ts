import {itBench} from "@dapplion/benchmark";
import {ssz} from "@chainsafe/lodestar-types";
import {validateGossipAttestation} from "../../../../src/chain/validation";
import {generateTestCachedBeaconStateOnlyValidators} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {getAttestationValidData} from "../../../utils/validationData/attestation";

describe("validate gossip attestation", () => {
  const vc = 64;
  const stateSlot = 100;

  const {chain, attestation, subnet} = getAttestationValidData({
    currentSlot: stateSlot,
    state: generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot}),
  });

  const attStruct = attestation;
  const attTreeBacked = ssz.phase0.Attestation.createTreeBackedFromStruct(attStruct);

  for (const [id, att] of Object.entries({struct: attStruct, treeBacked: attTreeBacked})) {
    itBench({
      id: `validate gossip attestation - ${id}`,
      beforeEach: () => chain.seenAttesters["validatorIndexesByEpoch"].clear(),
      fn: async () => {
        await validateGossipAttestation(chain, att, subnet);
      },
    });
  }
});
