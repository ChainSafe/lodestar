import {bench, describe} from "@chainsafe/benchmark";
import {PublicKey} from "@chainsafe/blst";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {Index2PubkeyCache} from "../../../../src/cache/pubkeyCache.js";
import {createCachedBeaconState} from "../../../../src/cache/stateCache.js";
import {loadState} from "../../../../src/util/loadState/loadState.js";
import {generatePerfTestCachedStateAltair} from "../../util.js";

/**
 * This benchmark shows a stable performance from 2s to 3s on a Mac M1. And it does not really depend on the seed validators,
 * only the modified and new validators
 */
describe("loadState", () => {
  const testCases: {seedValidators: number; numModifiedValidators: number; numNewValidators: number}[] = [
    // enable these tests if you want to see performance with different seed validators
    // {seedValidators: 1_500_000, numModifiedValidators: 24, numNewValidators: 0},
    // {seedValidators: 1_500_000, numModifiedValidators: 1700, numNewValidators: 1000},
    {seedValidators: 1_500_000, numModifiedValidators: 3400, numNewValidators: 2000},
  ];
  for (const {seedValidators, numModifiedValidators, numNewValidators} of testCases) {
    bench({
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
        const shufflingGetter = () => seedState.epochCtx.currentShuffling;
        createCachedBeaconState(
          migratedState,
          {
            config: seedState.config,
            pubkey2index,
            index2pubkey,
          },
          {skipSyncPubkeys: true, skipSyncCommitteeCache: true, shufflingGetter}
        );
      },
    });
  }
});
