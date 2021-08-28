import {itBench} from "@dapplion/benchmark";
import {ssz} from "@chainsafe/lodestar-types";
import {validateGossipAggregateAndProof} from "../../../../src/chain/validation";
import {generateTestCachedBeaconStateOnlyValidators} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {getAggregateAndProofValidData} from "../../../utils/validationData/aggregateAndProof";

describe("validate gossip signedAggregateAndProof", () => {
  const vc = 64;
  const stateSlot = 100;

  const {chain, signedAggregateAndProof} = getAggregateAndProofValidData({
    currentSlot: stateSlot,
    state: generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot}),
  });

  const aggStruct = signedAggregateAndProof;
  const aggTreeBacked = ssz.phase0.SignedAggregateAndProof.createTreeBackedFromStruct(aggStruct);

  for (const [id, agg] of Object.entries({struct: aggStruct, treeBacked: aggTreeBacked})) {
    itBench({
      id: `validate gossip signedAggregateAndProof - ${id}`,
      beforeEach: () => chain.seenAggregators["validatorIndexesByEpoch"].clear(),
      fn: async () => {
        await validateGossipAggregateAndProof(chain, agg);
      },
    });
  }
});
