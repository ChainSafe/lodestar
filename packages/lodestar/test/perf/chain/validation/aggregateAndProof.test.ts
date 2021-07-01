import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {ssz} from "@chainsafe/lodestar-types";
import {validateGossipAggregateAndProof} from "../../../../src/chain/validation";
import {generateTestCachedBeaconStateOnlyValidators} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {getAggregateAndProofValidData} from "../../../utils/validationData/aggregateAndProof";

describe("validate gossip signedAggregateAndProof", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 2 * 1000,
    runs: 1024,
  });

  const vc = 64;
  const stateSlot = 100;

  const {chain, signedAggregateAndProof} = getAggregateAndProofValidData({
    currentSlot: stateSlot,
    state: generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot}),
  });

  const aggStruct = signedAggregateAndProof;
  const aggTreeBacked = ssz.phase0.SignedAggregateAndProof.createTreeBackedFromStruct(aggStruct);

  itBench({
    id: "validate gossip signedAggregateAndProof - struct",
    beforeEach: () => {
      chain.seenAggregators["validatorIndexesByEpoch"].clear();
    },
    fn: async () => {
      await validateGossipAggregateAndProof(chain, aggStruct);
    },
  });

  itBench({
    id: "validate gossip signedAggregateAndProof - treeBacked",
    beforeEach: () => {
      chain.seenAggregators["validatorIndexesByEpoch"].clear();
    },
    fn: async () => {
      await validateGossipAggregateAndProof(chain, aggTreeBacked);
    },
  });
});
