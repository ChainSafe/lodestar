import {
  CachedBeaconStateAllForks,
  isBellatrixStateType,
  isBellatrixBlockBodyType,
  isMergeTransitionBlock as isMergeTransitionBlockFn,
  isExecutionEnabled,
} from "@lodestar/state-transition";
import {bellatrix, allForks, Slot} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";
import {IForkChoice, ExecutionStatus, assertValidTerminalPowBlock, ProtoBlock} from "@lodestar/fork-choice";
import {IChainForkConfig} from "@lodestar/config";
import {ErrorAborted, ILogger} from "@lodestar/utils";
import {IExecutionEngine} from "../../execution/engine/index.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {IBeaconClock} from "../clock/index.js";
import {BlockProcessOpts} from "../options.js";
import {ExecutePayloadStatus} from "../../execution/engine/interface.js";
import {IEth1ForBlockProduction} from "../../eth1/index.js";

export type VerifyBlockExecutionPayloadModules = {
  eth1: IEth1ForBlockProduction;
  executionEngine: IExecutionEngine;
  clock: IBeaconClock;
  logger: ILogger;
  forkChoice: IForkChoice;
  config: IChainForkConfig;
};

/**
 * Verifies 1 or more execution payloads from a linear sequence of blocks.
 *
 * Since the EL client must be aware of each parent, all payloads must be submited in sequence.
 */
export async function verifyBlocksExecutionPayload(
  chain: VerifyBlockExecutionPayloadModules,
  parentBlock: ProtoBlock,
  blocks: allForks.SignedBeaconBlock[],
  preState0: CachedBeaconStateAllForks,
  signal: AbortSignal,
  opts: BlockProcessOpts
): Promise<{executionStatuses: ExecutionStatus[]; mergeBlockFound: bellatrix.BeaconBlock | null}> {
  const executionStatuses: ExecutionStatus[] = [];
  let mergeBlockFound: bellatrix.BeaconBlock | null = null;

  // Error in the same way as verifyBlocksSanityChecks if empty blocks
  if (blocks.length === 0) {
    throw Error("Empty partiallyVerifiedBlocks");
  }

  // For a block with SYNCING status (called optimistic block), it's okay to import with
  // SYNCING status as EL could switch into syncing
  //
  // 1. On intial startup/restart
  // 2. When some reorg might have occured and EL doesn't has a parent root
  //    (observed on devnets)
  // 3. Because of some unavailable (and potentially invalid) root but there is no way
  //    of knowing if this is invalid/unavailable. For unavailable block, some proposer
  //    will (sooner or later) build on the available parent head which will
  //    eventually win in fork-choice as other validators vote on VALID blocks.
  //
  // Once EL catches up again and respond VALID, the fork choice will be updated which
  // will either validate or prune invalid blocks
  //
  // We need to track and keep updating if its safe to optimistically import these blocks.
  // The following is how we determine for a block if its safe:
  //
  // (but we need to modify this check for this segment of blocks because it checks if the
  //  parent of any block imported in forkchoice is post-merge and currently we could only
  //  have blocks[0]'s parent imported in the chain as this is no longer one by one verify +
  //  import.)
  //
  //
  // When to import such blocks:
  // From: https://github.com/ethereum/consensus-specs/pull/2844
  // A block MUST NOT be optimistically imported, unless either of the following
  // conditions are met:
  //
  // 1. Parent of the block has execution
  //
  //     Since with the sync optimizations, the previous block might not have been in the
  //     forkChoice yet, so the below check could fail for safeSlotsToImportOptimistically
  //
  //     Luckily, we can depend on the preState0 to see if we are already post merge w.r.t
  //     the blocks we are importing.
  //
  //     Or in other words if
  //       - block status is syncing
  //       - and we are not in a post merge world and is parent is not optimistically safe
  //       - and we are syncing close to the chain head i.e. clock slot
  //       - and parent is optimistically safe
  //
  //      then throw error
  //
  //
  //       - if we haven't yet imported a post merge ancestor in forkchoice i.e.
  //       - and we are syncing close to the clockSlot, i.e. merge Transition could be underway
  //
  //
  // 2. The current slot (as per the system clock) is at least
  //    SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY ahead of the slot of the block being
  //    imported.
  //    This means that the merge transition could be underway and we can't afford to import
  //    a block which is not fully validated as it could affect liveliness of the network.
  //
  //
  // For this segment of blocks:
  //   We are optimistically safe with respec to this entire block segment if:
  //    - all the blocks are way behind the current slot
  //    - or we have already imported a post-merge parent of first block of this chain in forkchoice
  const lastBlock = blocks[blocks.length - 1];

  const currentSlot = chain.clock.currentSlot;
  let isOptimisticallySafe =
    parentBlock.executionStatus !== ExecutionStatus.PreMerge ||
    lastBlock.message.slot + opts.safeSlotsToImportOptimistically < currentSlot;

  for (const block of blocks) {
    // If blocks are invalid in consensus the main promise could resolve before this loop ends.
    // In that case stop sending blocks to execution engine
    if (signal.aborted) {
      throw new ErrorAborted("verifyBlockExecutionPayloads");
    }

    const {executionStatus} = await verifyBlockExecutionPayload(
      chain,
      block,
      preState0,
      opts,
      isOptimisticallySafe,
      currentSlot
    );

    // It becomes optimistically  safe for following blocks if a post-merge block is deemed fit
    // for import. If it would not have been safe verifyBlockExecutionPayload would throw error
    // and we would not be here.
    if (executionStatus !== ExecutionStatus.PreMerge) {
      isOptimisticallySafe = true;
    }
    executionStatuses.push(executionStatus);

    const isMergeTransitionBlock =
      isBellatrixStateType(preState0) &&
      isBellatrixBlockBodyType(block.message.body) &&
      isMergeTransitionBlockFn(preState0, block.message.body);

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

      // executionStatus will never == ExecutionStatus.PreMerge if it's the mergeBlock. But gotta make TS happy =D
      if (executionStatus === ExecutionStatus.PreMerge) {
        throw Error("Merge block must not have executionStatus == PreMerge");
      }

      assertValidTerminalPowBlock(chain.config, mergeBlock, {executionStatus, powBlock, powBlockParent});

      // Valid execution payload, but may not be in a valid beacon chain block. Delay printing the POS ACTIVATED banner
      // to the end of the verify block routine, which confirms that this block is fully valid.
      mergeBlockFound = mergeBlock;
    }
  }

  return {executionStatuses, mergeBlockFound};
}

/**
 * Verifies a single block execution payload by sending it to the EL client (via HTTP).
 */
export async function verifyBlockExecutionPayload(
  chain: VerifyBlockExecutionPayloadModules,
  block: allForks.SignedBeaconBlock,
  preState0: CachedBeaconStateAllForks,
  opts: BlockProcessOpts,
  isOptimisticallySafe: boolean,
  currentSlot: Slot
): Promise<{executionStatus: ExecutionStatus}> {
  /** Not null if execution is enabled */
  const executionPayloadEnabled =
    isBellatrixStateType(preState0) &&
    isBellatrixBlockBodyType(block.message.body) &&
    // Safe to use with a state previous to block's preState. isMergeComplete can only transition from false to true.
    // - If preState0 is after merge block: condition is true, and will always be true
    // - If preState0 is before merge block: the block could lie but then state transition function will throw above
    // It is kinda safe to send non-trusted payloads to the execution client because at most it can trigger sync.
    // TODO: If this becomes a problem, do some basic verification beforehand, like checking the proposer signature.
    isExecutionEnabled(preState0, block.message)
      ? block.message.body.executionPayload
      : null;

  if (!executionPayloadEnabled) {
    // isExecutionEnabled() -> false
    return {executionStatus: ExecutionStatus.PreMerge};
  }

  // TODO: Handle better notifyNewPayload() returning error is syncing
  const execResult = await chain.executionEngine.notifyNewPayload(executionPayloadEnabled);

  switch (execResult.status) {
    case ExecutePayloadStatus.VALID:
      chain.forkChoice.validateLatestHash(execResult.latestValidHash, null);
      return {executionStatus: ExecutionStatus.Valid};

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
      // Check if the entire segment was deemed safe or, this block specifically itself if not in
      // the safeSlotsToImportOptimistically window of current slot, then we can import else
      // we need to throw and not import his block
      if (!isOptimisticallySafe && block.message.slot + opts.safeSlotsToImportOptimistically >= currentSlot) {
        throw new BlockError(block, {
          code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
          execStatus: ExecutePayloadStatus.UNSAFE_OPTIMISTIC_STATUS,
          errorMessage: `not safe to import ${execResult.status} payload within ${opts.safeSlotsToImportOptimistically} of currentSlot`,
        });
      }

      return {executionStatus: ExecutionStatus.Syncing};
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
    case ExecutePayloadStatus.ELERROR:
    case ExecutePayloadStatus.UNAVAILABLE:
      throw new BlockError(block, {
        code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
        execStatus: execResult.status,
        errorMessage: execResult.validationError,
      });
  }
}
