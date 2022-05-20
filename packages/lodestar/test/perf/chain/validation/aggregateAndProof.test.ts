import {itBench} from "@dapplion/benchmark";
import {validateGossipAggregateAndProof} from "../../../../src/chain/validation/index.js";
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../../beacon-state-transition/test/perf/util.js";
import {getAggregateAndProofValidData} from "../../../utils/validationData/aggregateAndProof.js";

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
      beforeEach: () => {
        chain.seenAggregators["validatorIndexesByEpoch"].clear();
        chain.seenAggregatedAttestations["aggregateRootsByEpoch"].clear();
      },
      fn: async () => {
        await validateGossipAggregateAndProof(chain, agg);
      },
    });
  }
});
