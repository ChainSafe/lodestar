import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {PublicKey} from "@chainsafe/blst";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {loadState} from "../../../../src/util/loadState/loadState.js";
import {createCachedBeaconState} from "../../../../src/cache/stateCache.js";
import {Index2PubkeyCache} from "../../../../src/cache/pubkeyCache.js";
import {generatePerfTestCachedStateAltair} from "../../util.js";

/**
 * This benchmark shows a stable performance from 2s to 3s on a Mac M1. And it does not really depend on the seed validators,
 * only the modified and new validators
 *
 * - On mainnet, as of Oct 2023, there are ~1M validators
 *
 *    ✔ migrate state 1000000 validators, 24 modified, 0 new               0.4475463 ops/s    2.234406  s/op        -          3 runs   62.1 s
 *    ✔ migrate state 1000000 validators, 1700 modified, 1000 new          0.3663298 ops/s    2.729781  s/op        -         21 runs   62.1 s
 *    ✔ migrate state 1000000 validators, 3400 modified, 2000 new          0.3413125 ops/s    2.929866  s/op        -         19 runs   60.9 s

 * - On holesky, there are ~1.5M validators
 *    ✔ migrate state 1500000 validators, 24 modified, 0 new               0.4278145 ops/s    2.337461  s/op        -         24 runs   61.1 s
 *    ✔ migrate state 1500000 validators, 1700 modified, 1000 new          0.3642085 ops/s    2.745680  s/op        -         20 runs   60.1 s
 *    ✔ migrate state 1500000 validators, 3400 modified, 2000 new          0.3344296 ops/s    2.990166  s/op        -         19 runs   62.4 s
 */
describe("loadState", function () {
  this.timeout(0);

  setBenchOpts({
    minMs: 60_000,
  });

  const testCases: {seedValidators: number; numModifiedValidators: number; numNewValidators: number}[] = [
    // this 1_000_000 is similar to mainnet state as of Oct 2023
    // similar to migrating from state 7335296 to state 7335360 on mainnet, this is 2 epochs difference
    {seedValidators: 1_000_000, numModifiedValidators: 24, numNewValidators: 0},
    {seedValidators: 1_000_000, numModifiedValidators: 1700, numNewValidators: 1000},
    // similar to migrating from state 7327776 to state 7335360 on mainnet, this is 237 epochs difference ~ 1 day
    {seedValidators: 1_000_000, numModifiedValidators: 3400, numNewValidators: 2000},
    // same tests on holesky with 1_500_000 validators
    {seedValidators: 1_500_000, numModifiedValidators: 24, numNewValidators: 0},
    {seedValidators: 1_500_000, numModifiedValidators: 1700, numNewValidators: 1000},
    {seedValidators: 1_500_000, numModifiedValidators: 3400, numNewValidators: 2000},
  ];
  for (const {seedValidators, numModifiedValidators, numNewValidators} of testCases) {
    itBench({
      id: `migrate state ${seedValidators} validators, ${numModifiedValidators} modified, ${numNewValidators} new`,
      before: () => {
        const seedState = generatePerfTestCachedStateAltair({vc: seedValidators, goBackOneSlot: false});
        // cache all HashObjects
        seedState.hashTreeRoot();
        const newState = seedState.clone();
        for (let i = 0; i < numModifiedValidators; i++) {
          const validatorIndex = i * Math.floor((seedState.validators.length - 1) / numModifiedValidators);
          const modifiedValidator = newState.validators.get(validatorIndex);
          modifiedValidator.withdrawalCredentials = Buffer.alloc(32, 0x01);
          newState.inactivityScores.set(validatorIndex, 100);
        }

        for (let i = 0; i < numNewValidators; i++) {
          newState.validators.push(seedState.validators.get(0).clone());
          newState.inactivityScores.push(seedState.inactivityScores.get(0));
          newState.balances.push(seedState.balances.get(0));
        }

        const newStateBytes = newState.serialize();
        return {seedState, newStateBytes};
      },
      beforeEach: ({seedState, newStateBytes}) => {
        return {seedState: seedState.clone(), newStateBytes};
      },
      fn: ({seedState, newStateBytes}) => {
        const {state: migratedState, modifiedValidators} = loadState(seedState.config, seedState, newStateBytes);
        migratedState.hashTreeRoot();
        // Get the validators sub tree once for all the loop
        const validators = migratedState.validators;
        const pubkey2index = new PubkeyIndexMap();
        const index2pubkey: Index2PubkeyCache = [];
        for (const validatorIndex of modifiedValidators) {
          const validator = validators.getReadonly(validatorIndex);
          const pubkey = validator.pubkey;
          pubkey2index.set(pubkey, validatorIndex);
          index2pubkey[validatorIndex] = PublicKey.fromBytes(pubkey);
        }
        createCachedBeaconState(
          migratedState,
          {
            config: seedState.config,
            pubkey2index,
            index2pubkey,
            shufflingCache: seedState.epochCtx.shufflingCache,
          },
          {skipSyncPubkeys: true, skipSyncCommitteeCache: true}
        );
      },
    });
  }
});
