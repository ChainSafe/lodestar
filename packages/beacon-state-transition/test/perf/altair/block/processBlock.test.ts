import {itBench} from "@dapplion/benchmark";
import {ssz} from "@chainsafe/lodestar-types";
import {
  ACTIVE_PRESET,
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_DEPOSITS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
  PresetName,
  SYNC_COMMITTEE_SIZE,
} from "@chainsafe/lodestar-params";
import {allForks, CachedBeaconStateAltair} from "../../../../src/index.js";
import {cachedStateAltairPopulateCaches, generatePerfTestCachedStateAltair, perfStateId} from "../../util";
import {BlockAltairOpts, getBlockAltair} from "../../phase0/block/util.js";
import {StateBlock} from "../../types.js";

// As of Jun 12 2021
// Process block
// ================================================================
// Process block with 0 validator exit                                    233.6434 ops/s      4.280027 ms/op   3491 runs    15.01 s
// Process block with 1 validator exit                                    41.33581 ops/s      24.19210 ms/op    619 runs    15.00 s
// Process block with 16 validator exits                                  42.34492 ops/s      23.61558 ms/op    635 runs    15.02 s

// Processing a block consist of three steps
// 1. Verifying signatures
// 2. Running block processing (state transition function)
// 3. Hashing the state
//
// Performance cost of each block depends on the size of the state + the operation counts in the block
//
//
// ### Verifying signatures
// Signature verification is done in bulk using batch BLS verification. Performance is proportional to the amount of
// sigs to verify and the cost to construct the signature sets from TreeView data.
//
// - Same as phase0
// - SyncAggregate sigs:     1 x agg (358 bits on avg) - TODO: assuming same participation as attestations
//
// A mainnet average block has:
//   92 (phase0) + 1 = 93 sigs
//   8100 (phase0) + 358 = 8458 pubkey aggregations
// A maxed block would have:
//   198 (phase0) + 1 = 199 sigs
//   16896 (phase0) + 512 = 17408 pubkey aggregations
//
//
// ### Running block processing
// Block processing is relatively fast, most of the cost is reading and writing tree data. The performance of
// processBlock is properly tracked with this performance test.
//
// - processBlockHeader        : phase0 same
// - processRandao             : phase0 same
// - processEth1Data           : phase0 same
// - processOperations         --
//   - processProposerSlashing : two constants changed, same perf
//   - processAttesterSlashing : two constants changed, same perf
//   - processAttestation      : new in altair
//   - processDeposit          : adds pushing to inactivityScores
//   - processVoluntaryExit    : phase0 same
// - processSyncAggregate      : new in altair
//
//
// ### Hashing the state
// Hashing cost is dependant on how many nodes have been modified in the tree. After mutating the state, just count
// how many nodes have no cached _root, then multiply by the cost of hashing.
//

describe("altair processBlock", () => {
  if (ACTIVE_PRESET !== PresetName.mainnet) {
    throw Error(`ACTIVE_PRESET ${ACTIVE_PRESET} must be mainnet`);
  }

  const testCases: {id: string; opts: BlockAltairOpts}[] = [
    {
      id: "normalcase",
      opts: {
        proposerSlashingLen: 0,
        attesterSlashingLen: 0,
        attestationLen: 90,
        depositsLen: 0,
        voluntaryExitLen: 0,
        bitsLen: 90,
        // TODO: There's no data yet on how full syncCommittee will be. Assume same ratio of attestations
        syncCommitteeBitsLen: Math.round(SYNC_COMMITTEE_SIZE * 0.7),
      },
    },
    {
      id: "worstcase",
      opts: {
        proposerSlashingLen: MAX_PROPOSER_SLASHINGS,
        attesterSlashingLen: MAX_ATTESTER_SLASHINGS,
        attestationLen: MAX_ATTESTATIONS,
        depositsLen: MAX_DEPOSITS,
        voluntaryExitLen: MAX_VOLUNTARY_EXITS,
        bitsLen: 128,
        syncCommitteeBitsLen: SYNC_COMMITTEE_SIZE,
      },
    },
  ];

  for (const {id, opts} of testCases) {
    for (const hashState of [false, true]) {
      itBench<StateBlock, StateBlock>({
        id: `altair processBlock - ${perfStateId} ${id}` + (hashState ? " hashState" : ""),
        before: () => {
          const state = generatePerfTestCachedStateAltair();
          const block = getBlockAltair(state as CachedBeaconStateAltair, opts);
          // Populate permanent root caches of the block
          ssz.altair.BeaconBlock.hashTreeRoot(block.message);
          // Populate tree root caches of the state
          state.hashTreeRoot();
          return {state, block};
        },
        beforeEach: ({state, block}) => {
          const stateCloned = state.clone();
          // Populate all state array caches (on the cloned instance)
          cachedStateAltairPopulateCaches(stateCloned as CachedBeaconStateAltair);
          return {state: stateCloned, block};
        },
        fn: ({state, block}) => {
          const postState = allForks.stateTransition(state, block, {
            verifyProposer: false,
            verifySignatures: false,
            verifyStateRoot: false,
          });

          // Not necessary to call commit here since it's called inside .stateTransition()

          if (hashState) {
            // set verifyStateRoot = false, and get the root here because the block root is wrong
            // normalcase vc 250_000: 6947 hashes - 8.683 ms
            // worstcase vc 250_000: 15297 hashes - 19.121 ms
            postState.hashTreeRoot();
          }
        },
      });
    }
  }
});
