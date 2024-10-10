import {itBench} from "@dapplion/benchmark";
import {ssz} from "@lodestar/types";
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../../state-transition/test/perf/util.js";
import {validateApiAggregateAndProof, validateGossipAggregateAndProof} from "../../../../src/chain/validation/index.js";
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
    const serializedData = ssz.phase0.SignedAggregateAndProof.serialize(aggStruct);

    itBench({
      id: `validate api signedAggregateAndProof - ${id}`,
      beforeEach: () => {
        chain.seenAggregators["validatorIndexesByEpoch"].clear();
        chain.seenAggregatedAttestations["aggregateRootsByEpoch"].clear();
      },
      fn: async () => {
        const fork = chain.config.getForkName(stateSlot);
        await validateApiAggregateAndProof(fork, chain, agg);
      },
    });

    itBench({
      id: `validate gossip signedAggregateAndProof - ${id}`,
      beforeEach: () => {
        chain.seenAggregators["validatorIndexesByEpoch"].clear();
        chain.seenAggregatedAttestations["aggregateRootsByEpoch"].clear();
      },
      fn: async () => {
        const fork = chain.config.getForkName(stateSlot);
        await validateGossipAggregateAndProof(fork, chain, agg, serializedData);
      },
    });
  }
});
