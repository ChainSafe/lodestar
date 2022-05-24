import {
  CachedBeaconStateAllForks,
  computeStartSlotAtEpoch,
  allForks,
  bellatrix,
} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";
import {IForkChoice, IProtoBlock, ExecutionStatus, assertValidTerminalPowBlock} from "@chainsafe/lodestar-fork-choice";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../../metrics/index.js";
import {IExecutionEngine} from "../../executionEngine/index.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {IBeaconClock} from "../clock/index.js";
import {BlockProcessOpts} from "../options.js";
import {IStateRegenerator, RegenCaller} from "../regen/index.js";
import {IBlsVerifier} from "../bls/index.js";
import {FullyVerifiedBlock, PartiallyVerifiedBlock} from "./types.js";
import {ExecutePayloadStatus} from "../../executionEngine/interface.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {IEth1ForBlockProduction} from "../../eth1/index.js";
import {POS_PANDA_MERGE_TRANSITION_BANNER} from "./utils/pandaMergeTransitionBanner.js";

export type VerifyBlockModules = {
  bls: IBlsVerifier;
  eth1: IEth1ForBlockProduction;
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
): Promise<{postState: CachedBeaconStateAllForks; executionStatus: ExecutionStatus}> {
  const {block, validProposerSignature, validSignatures} = partiallyVerifiedBlock;

  // TODO: Skip in process chain segment
  // Retrieve preState from cache (regen)
  const preState = await chain.regen.getPreState(block.message, RegenCaller.processBlocksInEpoch).catch((e) => {
    throw new BlockError(block, {code: BlockErrorCode.PRESTATE_MISSING, error: e as Error});
  });

  const isMergeTransitionBlock =
    bellatrix.isBellatrixStateType(preState) &&
    bellatrix.isBellatrixBlockBodyType(block.message.body) &&
    bellatrix.isMergeTransitionBlock(preState, block.message.body);

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

  /** Not null if execution is enabled */
  const executionPayloadEnabled =
    bellatrix.isBellatrixStateType(postState) &&
    bellatrix.isBellatrixBlockBodyType(block.message.body) &&
    bellatrix.isExecutionEnabled(postState, block.message.body)
      ? block.message.body.executionPayload
      : null;

  // Verify signatures after running state transition, so all SyncCommittee signed roots are known at this point.
  // We must ensure block.slot <= state.slot before running getAllBlockSignatureSets().
  // NOTE: If in the future multiple blocks signatures are verified at once, all blocks must be in the same epoch
  // so the attester and proposer shufflings are correct.
  if (useBlsBatchVerify && !validSignatures) {
    const signatureSets = validProposerSignature
      ? allForks.getAllBlockSignatureSetsExceptProposer(postState, block)
      : allForks.getAllBlockSignatureSets(postState, block);

    if (
      signatureSets.length > 0 &&
      !(await chain.bls.verifySignatureSets(signatureSets, {
        verifyOnMainThread: partiallyVerifiedBlock?.blsVerifyOnMainThread,
      }))
    ) {
      throw new BlockError(block, {code: BlockErrorCode.INVALID_SIGNATURE, state: postState});
    }
  }

  let executionStatus: ExecutionStatus;
  if (executionPayloadEnabled) {
    // TODO: Handle better notifyNewPayload() returning error is syncing
    const execResult = await chain.executionEngine.notifyNewPayload(executionPayloadEnabled);

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
          code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
          execStatus: execResult.status,
          errorMessage: execResult.validationError ?? "",
        });
      }

      // Accepted and Syncing have the same treatment, as final validation of block is pending
      case ExecutePayloadStatus.ACCEPTED:
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
        // From: https://github.com/ethereum/consensus-specs/pull/2844
        // A block MUST NOT be optimistically imported, unless either of the following
        // conditions are met:
        //
        // 1. Parent of the block has execution
        // 2. The justified checkpoint has execution enabled
        // 3. The current slot (as per the system clock) is at least
        //    SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY ahead of the slot of the block being
        //    imported.

        const parentRoot = toHexString(block.message.parentRoot);
        const parentBlock = chain.forkChoice.getBlockHex(parentRoot);
        const justifiedBlock = chain.forkChoice.getJustifiedBlock();

        if (
          !parentBlock ||
          // Following condition is the !(Not) of the safe import condition
          (parentBlock.executionStatus === ExecutionStatus.PreMerge &&
            justifiedBlock.executionStatus === ExecutionStatus.PreMerge &&
            block.message.slot + opts.safeSlotsToImportOptimistically > chain.clock.currentSlot)
        ) {
          throw new BlockError(block, {
            code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
            execStatus: ExecutePayloadStatus.UNSAFE_OPTIMISTIC_STATUS,
            errorMessage: `not safe to import ${execResult.status} payload within ${opts.safeSlotsToImportOptimistically} of currentSlot, status=${execResult.status}`,
          });
        }

        executionStatus = ExecutionStatus.Syncing;
        break;
      }

      // If the block has is not valid, or it referenced an invalid terminal block then the
      // block is invalid, however it has no bearing on any forkChoice cleanup
      //
      // There can be other reasons for which EL failed some of the observed ones are
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

      case ExecutePayloadStatus.INVALID_BLOCK_HASH:
      case ExecutePayloadStatus.INVALID_TERMINAL_BLOCK:
      case ExecutePayloadStatus.ELERROR:
      case ExecutePayloadStatus.UNAVAILABLE:
        throw new BlockError(block, {
          code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
          execStatus: execResult.status,
          errorMessage: execResult.validationError,
        });
    }

    // If this is a merge transition block, check to ensure if it references
    // a valid terminal PoW block.
    //
    // However specs define this check to be run inside forkChoice's onBlock
    // (https://github.com/ethereum/consensus-specs/blob/dev/specs/bellatrix/fork-choice.md#on_block)
    // but we perform the check here (as inspired from the lighthouse impl)
    //
    // Reasons:
    //  1. If the block is not valid, we should fail early and not wait till
    //     forkChoice import.
    //  2. It makes logical sense to pair it with the block validations and
    //     deal it with the external services like eth1 tracker here than
    //     in import block
    if (isMergeTransitionBlock) {
      const mergeBlock = block.message as bellatrix.BeaconBlock;
      const mergeBlockHash = toHexString(
        chain.config.getForkTypes(mergeBlock.slot).BeaconBlock.hashTreeRoot(mergeBlock)
      );
      const powBlockRootHex = toHexString(mergeBlock.body.executionPayload.parentHash);
      const powBlock = await chain.eth1.getPowBlock(powBlockRootHex).catch((error) => {
        // Lets just warn the user here, errors if any will be reported on
        // `assertValidTerminalPowBlock` checks
        chain.logger.warn(
          "Error fetching terminal PoW block referred in the merge transition block",
          {powBlockHash: powBlockRootHex, mergeBlockHash},
          error
        );
        return null;
      });
      const powBlockParent =
        powBlock &&
        (await chain.eth1.getPowBlock(powBlock.parentHash).catch((error) => {
          // Lets just warn the user here, errors if any will be reported on
          // `assertValidTerminalPowBlock` checks
          chain.logger.warn(
            "Error fetching parent of the terminal PoW block referred in the merge transition block",
            {powBlockParentHash: powBlock.parentHash, powBlock: powBlockRootHex, mergeBlockHash},
            error
          );
          return null;
        }));

      assertValidTerminalPowBlock(chain.config, mergeBlock, {executionStatus, powBlock, powBlockParent});
    }
  } else {
    // isExecutionEnabled() -> false
    executionStatus = ExecutionStatus.PreMerge;
  }

  // Check state root matches
  if (!byteArrayEquals(block.message.stateRoot, postState.hashTreeRoot())) {
    throw new BlockError(block, {
      code: BlockErrorCode.INVALID_STATE_ROOT,
      root: postState.hashTreeRoot(),
      expectedRoot: block.message.stateRoot,
      preState,
      postState,
    });
  }

  // All checks have passed, if this is a merge transition block we can log
  if (isMergeTransitionBlock) {
    logOnPowBlock(chain, block as bellatrix.SignedBeaconBlock);
  }

  return {postState, executionStatus};
}

function logOnPowBlock(chain: VerifyBlockModules, block: bellatrix.SignedBeaconBlock): void {
  const mergeBlock = block.message;
  const mergeBlockHash = toHexString(chain.config.getForkTypes(mergeBlock.slot).BeaconBlock.hashTreeRoot(mergeBlock));
  const mergeExecutionHash = toHexString(mergeBlock.body.executionPayload.blockHash);
  const mergePowHash = toHexString(mergeBlock.body.executionPayload.parentHash);
  chain.logger.info(POS_PANDA_MERGE_TRANSITION_BANNER);
  chain.logger.info("Execution transitioning from PoW to PoS!!!");
  chain.logger.info("Importing block referencing terminal PoW block", {
    blockHash: mergeBlockHash,
    executionHash: mergeExecutionHash,
    powHash: mergePowHash,
  });
}
