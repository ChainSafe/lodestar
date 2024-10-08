import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {expect} from "chai";
import {ssz} from "@lodestar/types";
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../../state-transition/test/perf/util.js";
import {validateGossipAttestationsSameAttData} from "../../../../src/chain/validation/index.js";
import {getAttestationValidData} from "../../../utils/validationData/attestation.js";
import {getAttDataFromAttestationSerialized} from "../../../../src/util/sszBytes.js";

describe("validate gossip attestation", () => {
  setBenchOpts({
    minMs: 30_000,
  });

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
      expect(subnet).to.be.equal(subnet0);
      attestations.push(attestation);
    }

    const attestationOrBytesArr = attestations.map((att) => {
      const serializedData = ssz.phase0.Attestation.serialize(att);
      return {
        attestation: null,
        serializedData,
        attSlot,
        attDataBase64: getAttDataFromAttestationSerialized(serializedData) as string,
      };
    });

    itBench({
      id: `batch validate gossip attestation - vc ${vc} - chunk ${chunkSize}`,
      beforeEach: () => chain.seenAttesters["validatorIndexesByEpoch"].clear(),
      fn: async () => {
        await validateGossipAttestationsSameAttData(fork, chain, attestationOrBytesArr, subnet0);
      },
      runsFactor: chunkSize,
    });
  }
});
