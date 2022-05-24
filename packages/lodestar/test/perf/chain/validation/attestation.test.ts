import {itBench} from "@dapplion/benchmark";
import {validateGossipAttestation} from "../../../../src/chain/validation/index.js";
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../../beacon-state-transition/test/perf/util.js";
import {getAttestationValidData} from "../../../utils/validationData/attestation.js";

describe("validate gossip attestation", () => {
  const vc = 64;
  const stateSlot = 100;

  const {chain, attestation, subnet} = getAttestationValidData({
    currentSlot: stateSlot,
    state: generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot}),
  });

  const attStruct = attestation;

  for (const [id, att] of Object.entries({struct: attStruct})) {
    itBench({
      id: `validate gossip attestation - ${id}`,
      beforeEach: () => chain.seenAttesters["validatorIndexesByEpoch"].clear(),
      fn: async () => {
        await validateGossipAttestation(chain, att, subnet);
      },
    });
  }
});
