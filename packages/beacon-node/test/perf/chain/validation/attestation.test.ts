import assert from "node:assert";
import {bench, describe} from "@chainsafe/benchmark";
import {ssz} from "@lodestar/types";
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../../state-transition/test/perf/util.js";
import {validateGossipAttestationsSameAttData} from "../../../../src/chain/validation/index.js";
import {getAttDataFromAttestationSerialized} from "../../../../src/util/sszBytes.js";
import {getAttestationValidData} from "../../../utils/validationData/attestation.js";

describe("validate gossip attestation", () => {
  const vc = 640_000;
  const stateSlot = 100;
  const state = generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot});

  const {
    chain,
    attestation: attestation0,
    subnet: subnet0,
  } = getAttestationValidData({
    currentSlot: stateSlot,
    state,
    bitIndex: 0,
    // enable this in local environment to match production
    // blsVerifyAllMainThread: false,
  });

  const attSlot = attestation0.data.slot;
  const fork = chain.config.getForkName(stateSlot);

  for (const chunkSize of [32, 64, 128, 256]) {
    const attestations = [attestation0];
    for (let i = 1; i < chunkSize; i++) {
      const {attestation, subnet} = getAttestationValidData({
        currentSlot: stateSlot,
        state,
        bitIndex: i,
      });
      assert.deepEqual(subnet, subnet0);
      attestations.push(attestation);
    }

    const attestationOrBytesArr = attestations.map((att) => {
      const serializedData = ssz.phase0.Attestation.serialize(att);
      return {
        attestation: null,
        serializedData,
        attSlot,
        attDataBase64: getAttDataFromAttestationSerialized(serializedData) as string,
        subnet: subnet0,
      };
    });

    bench({
      id: `batch validate gossip attestation - vc ${vc} - chunk ${chunkSize}`,
      beforeEach: () => chain.seenAttesters["validatorIndexesByEpoch"].clear(),
      fn: async () => {
        await validateGossipAttestationsSameAttData(fork, chain, attestationOrBytesArr);
      },
      runsFactor: chunkSize,
    });
  }
});
