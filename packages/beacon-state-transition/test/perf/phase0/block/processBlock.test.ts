import {itBench} from "@dapplion/benchmark";
import {
  ACTIVE_PRESET,
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_DEPOSITS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
  PresetName,
} from "@chainsafe/lodestar-params";
import {allForks} from "../../../../src/index.js";
import {generatePerfTestCachedStatePhase0, perfStateId} from "../../util";
import {BlockOpts, getBlockPhase0} from "./util.js";
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
// - Proposer sig:           1 single
// - RandaoReveal sig:       1 single
// - ProposerSlashings sigs: ops x 2 single
// - AttesterSlashings sigs: ops x 2 agg (90 bits on avg)
// - Attestations sigs:      ops x 1 agg (90 bits on avg)
// - VoluntaryExits sigs:    ops x 1 single
// - Deposits sigs:          ops x 1 single
//
// A mainnet average block has:
//   1 + 1 + 90 = 92 sigs
//   90 * 90 = 8100 pubkey aggregations
// A maxed block would have:
//   1 + 1 + 16 * 2 + 2 * 2 + 128 + 16 + 16 = 198 sigs
//   2 * 2 * 128 + 128 * 128 = 16896 pubkey aggregations
//
//
// ### Running block processing
// Block processing is relatively fast, most of the cost is reading and writing tree data. The performance of
// processBlock is properly tracked with this performance test.
//
// - processBlockHeader        : -
// - processRandao             : -
// - processEth1Data           : -
// - processOperations         --
//   - processProposerSlashing : -
//   - processAttesterSlashing : -
//   - processAttestation      : -
//   - processDeposit          : -
//   - processVoluntaryExit    : -
//
// ### Hashing the state
// Hashing cost is dependant on how many nodes have been modified in the tree. After mutating the state, just count
// how many nodes have no cached _root, then multiply by the cost of hashing.
//

describe("phase0 processBlock", () => {
  if (ACTIVE_PRESET !== PresetName.mainnet) {
    throw Error(`ACTIVE_PRESET ${ACTIVE_PRESET} must be mainnet`);
  }

  const testCases: {id: string; opts: BlockOpts}[] = [
    {
      id: "normalcase",
      opts: {
        proposerSlashingLen: 0,
        attesterSlashingLen: 0,
        attestationLen: 90,
        depositsLen: 0,
        voluntaryExitLen: 0,
        bitsLen: 90,
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
      },
    },
  ];

  for (const {id, opts} of testCases) {
    itBench<StateBlock, StateBlock>({
      id: `phase0 processBlock - ${perfStateId} ${id}`,
      before: () => {
        const state = generatePerfTestCachedStatePhase0();
        const block = getBlockPhase0(state, opts);
        state.hashTreeRoot();
        return {block, state};
      },
      beforeEach: ({state, block}) => ({state: state.clone(), block}),
      fn: ({state, block}) => {
        allForks.stateTransition(state, block, {
          verifyProposer: false,
          verifySignatures: false,
          verifyStateRoot: false,
        });
        // set verifyStateRoot = false, and get the root here because the block root is wrong
        state.hashTreeRoot();
      },
    });
  }
});
