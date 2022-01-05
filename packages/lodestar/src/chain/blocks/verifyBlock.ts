import {ssz} from "@chainsafe/lodestar-types";
import {SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY} from "@chainsafe/lodestar-params";
import {
  CachedBeaconState,
  computeStartSlotAtEpoch,
  allForks,
  merge,
  getCurrentSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";
import {IForkChoice, IProtoBlock, ExecutionStatus} from "@chainsafe/lodestar-fork-choice";
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
  const parentBlock = verifyBlockSanityChecks(chain, partiallyVerifiedBlock);

  const {postState, executionStatus} = await verifyBlockStateTransition(chain, partiallyVerifiedBlock, opts);

  return {
    block: partiallyVerifiedBlock.block,
    postState,
    parentBlock,
    skipImportingAttestations: partiallyVerifiedBlock.skipImportingAttestations,
    executionStatus,
  };
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
): IProtoBlock {
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
  const parentBlock = chain.forkChoice.getBlockHex(parentRoot);
  if (!parentBlock) {
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

  return parentBlock;
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
): Promise<{postState: CachedBeaconState<allForks.BeaconState>; executionStatus: ExecutionStatus}> {
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

  let executionStatus: ExecutionStatus;
  if (executionPayloadEnabled) {
    // TODO: Handle better executePayload() returning error is syncing
    const execResult = await chain.executionEngine.executePayload(
      // executionPayload must be serialized as JSON and the TreeBacked structure breaks the baseFeePerGas serializer
      // For clarity and since it's needed anyway, just send the struct representation at this level such that
      // executePayload() can expect a regular JS object.
      // TODO: If blocks are no longer TreeBacked, remove.
      executionPayloadEnabled.valueOf() as typeof executionPayloadEnabled
    );

    switch (execResult.status) {
      case ExecutePayloadStatus.VALID:
        executionStatus = ExecutionStatus.Valid;
        chain.forkChoice.validateLatestHash(execResult.latestValidHash, null);
        break; // OK

      case ExecutePayloadStatus.INVALID: {
        // If the parentRoot is not same as latestValidHash, then the branch from latestValidHash
        // to parentRoot needs to be invalidated
        const parentHashHex = toHexString(block.message.parentRoot);
        chain.forkChoice.validateLatestHash(
          execResult.latestValidHash,
          parentHashHex !== execResult.latestValidHash ? parentHashHex : null
        );
        throw new BlockError(block, {
          code: BlockErrorCode.EXECUTION_PAYLOAD_NOT_VALID,
          errorMessage: execResult.validationError ?? "",
        });
      }

      case ExecutePayloadStatus.SYNCING: {
        // It's okay to ignore SYNCING status as EL could switch into syncing
        // 1. On intial startup/restart
        // 2. When some reorg might have occured and EL doesn't has a parent root
        //    (observed on devnets)
        // 3. Because of some unavailable (and potentially invalid) root but there is no way
        //    of knowing if this is invalid/unavailable. For unavailable block, some proposer
        //    will (sooner or later) build on the available parent head which will
        //    eventually win in fork-choice as other validators vote on VALID blocks.
        // Once EL catches up again and respond VALID, the fork choice will be updated which
        // will either validate or prune invalid blocks
        //
        // When to import such blocks:
        // From: https://github.com/ethereum/consensus-specs/pull/2770/files
        // A block MUST NOT be optimistically imported, unless either of the following
        // conditions are met:
        //
        // 1. The justified checkpoint has execution enabled
        // 2. The current slot (as per the system clock) is at least
        //    SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY ahead of the slot of the block being
        //    imported.
        const justifiedBlock = chain.forkChoice.getJustifiedBlock();
        const clockSlot = getCurrentSlot(chain.config, postState.genesisTime);

        if (
          justifiedBlock.executionStatus === ExecutionStatus.PreMerge &&
          block.message.slot + SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY > clockSlot
        ) {
          throw new BlockError(block, {
            code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
            errorMessage: `not safe to import SYNCING payload within ${SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY} of currentSlot`,
          });
        }

        executionStatus = ExecutionStatus.Syncing;
        if (execResult.latestValidHash) {
          chain.forkChoice.validateLatestHash(execResult.latestValidHash, null);
        }
        break;
      }

      // There can be many reasons for which EL failed some of the observed ones are
      // 1. Connection refused / can't connect to EL port
      // 2. EL Internal Error
      // 3. Geth sometimes gives invalid merkel root error which means invalid
      //    but expects it to be handled in CL as of now. But we should log as warning
      //    and give it as optimistic treatment and expect any other non-geth CL<>EL
      //    combination to reject the invalid block and propose a block.
      //    On kintsugi devnet, this has been observed to cause contiguous proposal failures
      //    as the network is geth dominated, till a non geth node proposes and moves network
      //    forward
      // For network/unreachable errors, an optimization can be added to replay these blocks
      // back. But for now, lets assume other mechanisms like unknown parent block of a future
      // child block will cause it to replay
      case ExecutePayloadStatus.ELERROR:
      case ExecutePayloadStatus.UNAVAILABLE:
        throw new BlockError(block, {
          code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
          errorMessage: execResult.validationError,
        });
    }
  } else {
    // isExecutionEnabled() -> false
    executionStatus = ExecutionStatus.PreMerge;
  }

  // Check state root matches
  if (!ssz.Root.equals(block.message.stateRoot, postState.tree.root)) {
    throw new BlockError(block, {code: BlockErrorCode.INVALID_STATE_ROOT, preState, postState});
  }

  return {postState, executionStatus};
}
