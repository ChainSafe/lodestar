import {bench, describe} from "@chainsafe/benchmark";
import {generateTestCachedBeaconStateOnlyValidators} from "@lodestar/state-transition/test-utils";
import {ssz} from "@lodestar/types";
import type {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
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

    bench({
      id: `validate api signedAggregateAndProof - ${id}`,
      beforeEach: () => {
        chain.seenAggregators["validatorIndexesByEpoch"].clear();
        chain.seenAggregatedAttestations["aggregateRootsByEpoch"].clear();
      },
      fn: async () => {
        const fork = chain.config.getForkName(stateSlot);
        await validateApiAggregateAndProof.call(chain.beaconEngine as BeaconEngine, fork, agg);
      },
    });

    bench({
      id: `validate gossip signedAggregateAndProof - ${id}`,
      beforeEach: () => {
        chain.seenAggregators["validatorIndexesByEpoch"].clear();
        chain.seenAggregatedAttestations["aggregateRootsByEpoch"].clear();
      },
      fn: async () => {
        const fork = chain.config.getForkName(stateSlot);
        await validateGossipAggregateAndProof.call(chain.beaconEngine as BeaconEngine, fork, agg, serializedData);
      },
    });
  }
});
