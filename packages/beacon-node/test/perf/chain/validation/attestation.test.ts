import {itBench} from "@dapplion/benchmark";
import {ssz} from "@lodestar/types";
// eslint-disable-next-line import/no-relative-packages
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../../state-transition/test/perf/util.js";
import {validateApiAttestation, validateGossipAttestation} from "../../../../src/chain/validation/index.js";
import {getAttestationValidData} from "../../../utils/validationData/attestation.js";

describe("validate attestation", () => {
  const vc = 64;
  const stateSlot = 100;

  const {chain, attestation, subnet} = getAttestationValidData({
    currentSlot: stateSlot,
    state: generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot}),
  });

  const attStruct = attestation;

  for (const [id, att] of Object.entries({struct: attStruct})) {
    const serializedData = ssz.phase0.Attestation.serialize(att);
    const slot = attestation.data.slot;
    itBench({
      id: `validate api attestation - ${id}`,
      beforeEach: () => chain.seenAttesters["validatorIndexesByEpoch"].clear(),
      fn: async () => {
        await validateApiAttestation(chain, {attestation: att, serializedData: null});
      },
    });

    itBench({
      id: `validate gossip attestation - ${id}`,
      beforeEach: () => chain.seenAttesters["validatorIndexesByEpoch"].clear(),
      fn: async () => {
        const fork = chain.config.getForkName(stateSlot);
        await validateGossipAttestation(fork, chain, {attestation: null, serializedData, attSlot: slot}, subnet);
      },
    });
  }
});
