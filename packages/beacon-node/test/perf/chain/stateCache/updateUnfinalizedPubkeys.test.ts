import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {Map as ImmutableMap} from "immutable";
import {toBufferBE} from "bigint-buffer";
import {digest} from "@chainsafe/as-sha256";
import {SecretKey} from "@chainsafe/blst";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {ValidatorIndex, ssz} from "@lodestar/types";
import {type CachedBeaconStateAllForks, toMemoryEfficientHexStr} from "@lodestar/state-transition";
import {bytesToBigInt, intToBytes} from "@lodestar/utils";
import {InMemoryCheckpointStateCache, BlockStateCacheImpl} from "../../../../src/chain/stateCache/index.js";
import {BlockStateCache} from "../../../../src/chain/stateCache/types.js";
import {generateCachedElectraState} from "../../../utils/state.js";

// Benchmark date from Mon Nov 21 2023 - Intel Core i7-9750H @ 2.60Ghz
// ✔ updateUnfinalizedPubkeys - updating 10 pubkeys                      1444.173 ops/s    692.4380 us/op        -       1057 runs   6.03 s
// ✔ updateUnfinalizedPubkeys - updating 100 pubkeys                     189.5965 ops/s    5.274358 ms/op        -         57 runs   1.15 s
// ✔ updateUnfinalizedPubkeys - updating 1000 pubkeys                    12.90495 ops/s    77.48967 ms/op        -         13 runs   1.62 s
describe("updateUnfinalizedPubkeys perf tests", () => {
  setBenchOpts({noThreshold: true});

  const numPubkeysToBeFinalizedCases = [10, 100, 1000];
  const numCheckpointStateCache = 8;
  const numStateCache = 3 * 32;

  let checkpointStateCache: InMemoryCheckpointStateCache;
  let stateCache: BlockStateCache;

  const unfinalizedPubkey2Index = generatePubkey2Index(0, Math.max.apply(null, numPubkeysToBeFinalizedCases));
  const baseState = generateCachedElectraState();

  for (const numPubkeysToBeFinalized of numPubkeysToBeFinalizedCases) {
    itBench({
      id: `updateUnfinalizedPubkeys - updating ${numPubkeysToBeFinalized} pubkeys`,
      beforeEach: async () => {
        baseState.epochCtx.unfinalizedPubkey2index = ImmutableMap(unfinalizedPubkey2Index);
        baseState.epochCtx.pubkey2index = new PubkeyIndexMap();
        baseState.epochCtx.index2pubkey = [];

        checkpointStateCache = new InMemoryCheckpointStateCache({});
        stateCache = new BlockStateCacheImpl({});

        for (let i = 0; i < numCheckpointStateCache; i++) {
          const clonedState = baseState.clone();
          const checkpoint = ssz.phase0.Checkpoint.defaultValue();

          clonedState.slot = i;
          checkpoint.epoch = i; // Assigning arbitrary non-duplicate values to ensure checkpointStateCache correctly saves all the states

          checkpointStateCache.add(checkpoint, clonedState);
        }

        for (let i = 0; i < numStateCache; i++) {
          const clonedState = baseState.clone();
          clonedState.slot = i;
          stateCache.add(clonedState);
        }
      },
      fn: async () => {
        const newFinalizedValidators = baseState.epochCtx.unfinalizedPubkey2index.filter(
          (index, _pubkey) => index < numPubkeysToBeFinalized
        );

        const states = stateCache.getStates();
        const cpStates = checkpointStateCache.getStates();

        const firstState = states.next().value as CachedBeaconStateAllForks;
        firstState.epochCtx.addFinalizedPubkeys(newFinalizedValidators);

        const pubkeysToDelete = Array.from(newFinalizedValidators.keys());

        firstState.epochCtx.deleteUnfinalizedPubkeys(pubkeysToDelete);

        for (const s of states) {
          s.epochCtx.deleteUnfinalizedPubkeys(pubkeysToDelete);
        }

        for (const s of cpStates) {
          s.epochCtx.deleteUnfinalizedPubkeys(pubkeysToDelete);
        }
      },
    });
  }

  type PubkeyHex = string;

  function generatePubkey2Index(startIndex: number, endIndex: number): Map<PubkeyHex, ValidatorIndex> {
    const pubkey2Index = new Map<string, number>();
    const pubkeys = generatePubkeys(endIndex - startIndex);

    for (let i = startIndex; i < endIndex; i++) {
      pubkey2Index.set(toMemoryEfficientHexStr(pubkeys[i]), i);
    }

    return pubkey2Index;
  }

  function generatePubkeys(validatorCount: number): Uint8Array[] {
    const keys = [];

    for (let i = 0; i < validatorCount; i++) {
      const sk = generatePrivateKey(i);
      const pk = sk.toPublicKey().toBytes();
      keys.push(pk);
    }

    return keys;
  }

  function generatePrivateKey(index: number): SecretKey {
    const secretKeyBytes = toBufferBE(bytesToBigInt(digest(intToBytes(index, 32))) % BigInt("38581184513"), 32);
    const secret: SecretKey = SecretKey.fromBytes(secretKeyBytes);
    return secret;
  }
});
