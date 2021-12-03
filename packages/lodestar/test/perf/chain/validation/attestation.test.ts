import {itBench} from "@dapplion/benchmark";
import {ssz} from "@chainsafe/lodestar-types";
import {validateGossipAttestation} from "../../../../src/chain/validation";
import {generateTestCachedBeaconStateOnlyValidators} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {getAttestationValidData} from "../../../utils/validationData/attestation";
import {AttestationError, AttestationErrorCode, GossipAction} from "../../../../src/chain/errors";
import {ZERO_HASH} from "../../../../src/constants";

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

describe.only("test throw AttestationError vs object", () => {
  itBench({
    id: "AttestationError x1000",
    runsFactor: 1000,
    fn: async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          await throwAttestationError();
        } catch (e) {}
      }
    },
  });

  itBench({
    id: "Object x1000",
    runsFactor: 1000,
    fn: async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          await throwObject();
        } catch (e) {}
      }
    },
  });
});

async function throwAttestationError(): Promise<void> {
  throw new AttestationError(GossipAction.IGNORE, {
    code: AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
    root: ZERO_HASH,
  });
}

async function throwObject(): Promise<void> {
  throw {
    action: GossipAction.IGNORE,
    code: AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
    root: ZERO_HASH,
  };
}
