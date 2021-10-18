import {ssz} from "@chainsafe/lodestar-types";
import {CachedBeaconState, computeStartSlotAtEpoch, allForks, merge} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../../metrics";
import {IExecutionEngine} from "../../executionEngine";
import {BlockError, BlockErrorCode} from "../errors";
import {IBeaconClock} from "../clock";
import {BlockProcessOpts} from "../options";
import {IStateRegenerator, RegenCaller} from "../regen";
import {IBlsVerifier} from "../bls";
import {FullyVerifiedBlock, PartiallyVerifiedBlock} from "./types";
import {ExecutePayloadStatus} from "../../executionEngine/interface";

export type VerifyBlockModules = {
  bls: IBlsVerifier;
  executionEngine: IExecutionEngine;
  regen: IStateRegenerator;
  clock: IBeaconClock;
  logger: ILogger;
  forkChoice: IForkChoice;
  config: IChainForkConfig;
  metrics: IMetrics | null;
};

/**
 * Fully verify a block to be imported immediately after. Does not produce any side-effects besides adding intermediate
 * states in the state cache through regen.
 */
export async function verifyBlock(
  chain: VerifyBlockModules,
  partiallyVerifiedBlock: PartiallyVerifiedBlock,
  opts: BlockProcessOpts
): Promise<FullyVerifiedBlock> {
  verifyBlockSanityChecks(chain, partiallyVerifiedBlock);
  return await verifyBlockStateTransition(chain, partiallyVerifiedBlock, opts);
}

/**
 * Verifies som early cheap sanity checks on the block before running the full state transition.
 *
 * - Parent is known to the fork-choice
 * - Check skipped slots limit
 * - check_block_relevancy()
 *   - Block not in the future
 *   - Not genesis block
 *   - Block's slot is < Infinity
 *   - Not finalized slot
 *   - Not already known
 */
export function verifyBlockSanityChecks(
  chain: VerifyBlockModules,
  partiallyVerifiedBlock: PartiallyVerifiedBlock
): void {
  const {block} = partiallyVerifiedBlock;
  const blockSlot = block.message.slot;

  // Not genesis block
  if (blockSlot === 0) {
    throw new BlockError(block, {code: BlockErrorCode.GENESIS_BLOCK});
  }

  // Not finalized slot
  const finalizedSlot = computeStartSlotAtEpoch(chain.forkChoice.getFinalizedCheckpoint().epoch);
  if (blockSlot <= finalizedSlot) {
    throw new BlockError(block, {code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT, blockSlot, finalizedSlot});
  }

  // Parent is known to the fork-choice
  const parentRoot = toHexString(block.message.parentRoot);
  if (!chain.forkChoice.hasBlockHex(parentRoot)) {
    throw new BlockError(block, {code: BlockErrorCode.PARENT_UNKNOWN, parentRoot});
  }

  // Check skipped slots limit
  // TODO

  // Block not in the future, also checks for infinity
  const currentSlot = chain.clock.currentSlot;
  if (blockSlot > currentSlot) {
    throw new BlockError(block, {code: BlockErrorCode.FUTURE_SLOT, blockSlot, currentSlot});
  }

  // Not already known
  const blockHash = toHexString(chain.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message));
  if (chain.forkChoice.hasBlockHex(blockHash)) {
    throw new BlockError(block, {code: BlockErrorCode.ALREADY_KNOWN, root: blockHash});
  }
}

/**
 * Verifies a block is fully valid running the full state transition. To relieve the main thread signatures are
 * verified separately in workers with chain.bls worker pool.
 *
 * - Advance state to block's slot - per_slot_processing()
 * - STFN - per_block_processing()
 * - Check state root matches
 */
export async function verifyBlockStateTransition(
  chain: VerifyBlockModules,
  partiallyVerifiedBlock: PartiallyVerifiedBlock,
  opts: BlockProcessOpts
): Promise<FullyVerifiedBlock> {
  const {block, validProposerSignature, validSignatures} = partiallyVerifiedBlock;

  // TODO: Skip in process chain segment
  // Retrieve preState from cache (regen)
  const preState = await chain.regen.getPreState(block.message, RegenCaller.processBlocksInEpoch).catch((e) => {
    throw new BlockError(block, {code: BlockErrorCode.PRESTATE_MISSING, error: e as Error});
  });

  // STFN - per_slot_processing() + per_block_processing()
  // NOTE: `regen.getPreState()` should have dialed forward the state already caching checkpoint states
  const useBlsBatchVerify = !opts?.disableBlsBatchVerify;
  const postState = allForks.stateTransition(
    preState,
    block,
    {
      // false because it's verified below with better error typing
      verifyStateRoot: false,
      // if block is trusted don't verify proposer or op signature
      verifyProposer: !useBlsBatchVerify && !validSignatures && !validProposerSignature,
      verifySignatures: !useBlsBatchVerify && !validSignatures,
    },
    chain.metrics
  );

  // TODO: Review mergeBlock conditions
  /** Not null if execution is enabled */
  const executionPayloadEnabled =
    merge.isMergeStateType(postState) &&
    merge.isMergeBlockBodyType(block.message.body) &&
    merge.isExecutionEnabled(postState, block.message.body)
      ? block.message.body.executionPayload
      : null;

  // Verify signatures after running state transition, so all SyncCommittee signed roots are known at this point.
  // We must ensure block.slot <= state.slot before running getAllBlockSignatureSets().
  // NOTE: If in the future multiple blocks signatures are verified at once, all blocks must be in the same epoch
  // so the attester and proposer shufflings are correct.
  if (useBlsBatchVerify && !validSignatures) {
    const signatureSets = validProposerSignature
      ? allForks.getAllBlockSignatureSetsExceptProposer(postState, block)
      : allForks.getAllBlockSignatureSets(postState as CachedBeaconState<allForks.BeaconState>, block);

    if (signatureSets.length > 0 && !(await chain.bls.verifySignatureSets(signatureSets))) {
      throw new BlockError(block, {code: BlockErrorCode.INVALID_SIGNATURE, state: postState});
    }
  }

  if (executionPayloadEnabled) {
    // TODO: Handle better executePayload() returning error is syncing
    const status = await chain.executionEngine.executePayload(
      // executionPayload must be serialized as JSON and the TreeBacked structure breaks the baseFeePerGas serializer
      // For clarity and since it's needed anyway, just send the struct representation at this level such that
      // executePayload() can expect a regular JS object.
      // TODO: If blocks are no longer TreeBacked, remove.
      executionPayloadEnabled.valueOf() as typeof executionPayloadEnabled
    );

    switch (status) {
      case ExecutePayloadStatus.VALID:
        break; // OK
      case ExecutePayloadStatus.INVALID:
        throw new BlockError(block, {code: BlockErrorCode.EXECUTION_PAYLOAD_NOT_VALID});
      case ExecutePayloadStatus.SYNCING:
        // It's okay to ignore SYNCING status because:
        // - We MUST verify execution payloads of blocks we attest
        // - We are NOT REQUIRED to check the execution payload of blocks we don't attest
        // When EL syncs from genesis to a chain post-merge, it doesn't know what the head, CL knows. However, we
        // must verify (complete this fn) and import a block to sync. Since we are syncing we only need to verify
        // consensus and trust that whatever the chain agrees is valid, is valid; no need to verify. When we
        // verify consensus up to the head we notify forkchoice update head and then EL can sync to our head. At that
        // point regular EL sync kicks in and it does verify the execution payload (EL blocks). If after syncing EL
        // gets to an invalid payload or we can prepare payloads on what we consider the head that's a critical error
        //
        // TODO: Exit with critical error if we can't prepare payloads on top of what we consider head.
        if (partiallyVerifiedBlock.fromRangeSync) {
          break;
        } else {
          throw new BlockError(block, {code: BlockErrorCode.EXECUTION_ENGINE_SYNCING});
        }
    }
  }

  // Check state root matches
  if (!ssz.Root.equals(block.message.stateRoot, postState.tree.root)) {
    throw new BlockError(block, {code: BlockErrorCode.INVALID_STATE_ROOT, preState, postState});
  }

  return {
    block,
    postState,
    skipImportingAttestations: partiallyVerifiedBlock.skipImportingAttestations,
  };
}
