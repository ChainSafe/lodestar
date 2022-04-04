import {itBench} from "@dapplion/benchmark";
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

  for (const [id, agg] of Object.entries({struct: aggStruct})) {
    itBench({
      id: `validate gossip signedAggregateAndProof - ${id}`,
      beforeEach: () => chain.seenAggregators["validatorIndexesByEpoch"].clear(),
      fn: async () => {
        await validateGossipAggregateAndProof(chain, agg);
      },
    });
  }
});
