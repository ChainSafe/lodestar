import {itBench} from "@dapplion/benchmark";
import {ssz} from "@chainsafe/lodestar-types";
import {validateGossipAttestation} from "../../../../src/chain/validation";
import {generateTestCachedBeaconStateOnlyValidators} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {getAttestationValidData} from "../../../utils/validationData/attestation";
import {AttestationError, AttestationErrorCode, GossipAction} from "../../../../src/chain/errors";

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
    id: "AttestationError",
    fn: async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          await throwAttestationError(true);
        } catch (e) {}
      }
    }
  });

  itBench({
    id: "Object",
    fn: async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          await throwObject(true);
        } catch (e) {}
      }
    }
  });
});

async function throwAttestationError(b: boolean): Promise<void> {
  if (b) {
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
      root: Buffer.alloc(32),
    });
  }
}

async function throwObject(b: boolean): Promise<void> {
  if (b) {
    throw {
      action: GossipAction.IGNORE,
      code: AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
      root: Buffer.alloc(32),
    };
  }
}
