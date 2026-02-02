import {ChainForkConfig} from "@lodestar/config";
import {
  ExecutionStatus,
  IForkChoice,
  LVHInvalidResponse,
  LVHValidResponse,
  MaybeValidExecutionStatus,
  ProtoBlock,
} from "@lodestar/fork-choice";
import {ForkSeq} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  isExecutionBlockBodyType,
  isExecutionEnabled,
  isExecutionStateType,
} from "@lodestar/state-transition";
import {bellatrix, electra} from "@lodestar/types";
import {ErrorAborted, Logger, toRootHex} from "@lodestar/utils";
import {ExecutionPayloadStatus, IExecutionEngine} from "../../execution/engine/interface.js";
import {Metrics} from "../../metrics/metrics.js";
import {IClock} from "../../util/clock.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import {isBlockInputBlobs, isBlockInputColumns} from "./blockInput/blockInput.js";
import {IBlockInput} from "./blockInput/types.js";
import {ImportBlockOpts} from "./types.js";

export type VerifyBlockExecutionPayloadModules = {
  executionEngine: IExecutionEngine;
  clock: IClock;
  logger: Logger;
  metrics: Metrics | null;
  forkChoice: IForkChoice;
  config: ChainForkConfig;
};

type ExecAbortType = {blockIndex: number; execError: BlockError};
export type SegmentExecStatus =
  | {
      execAborted: null;
      executionStatuses: MaybeValidExecutionStatus[];
      executionTime: number;
    }
  | {execAborted: ExecAbortType; invalidSegmentLVH?: LVHInvalidResponse};

type VerifyExecutionErrorResponse =
  | {executionStatus: ExecutionStatus.Invalid; lvhResponse: LVHInvalidResponse; execError: BlockError}
  | {executionStatus: null; lvhResponse: undefined; execError: BlockError};

type VerifyBlockExecutionResponse =
  | VerifyExecutionErrorResponse
  | {executionStatus: ExecutionStatus.Valid; lvhResponse: LVHValidResponse; execError: null}
  | {executionStatus: ExecutionStatus.Syncing; lvhResponse?: LVHValidResponse; execError: null}
  | {executionStatus: ExecutionStatus.PreMerge; lvhResponse: undefined; execError: null};

/**
 * Verifies 1 or more execution payloads from a linear sequence of blocks.
 *
 * Since the EL client must be aware of each parent, all payloads must be submitted in sequence.
 */
export async function verifyBlocksExecutionPayload(
  chain: VerifyBlockExecutionPayloadModules,
  parentBlock: ProtoBlock,
  blockInputs: IBlockInput[],
  preState0: CachedBeaconStateAllForks,
  signal: AbortSignal,
  opts: BlockProcessOpts & ImportBlockOpts
): Promise<SegmentExecStatus> {
  const executionStatuses: MaybeValidExecutionStatus[] = [];
  const recvToValLatency = Date.now() / 1000 - (opts.seenTimestampSec ?? Date.now() / 1000);
  const lastBlock = blockInputs.at(-1);

  // Error in the same way as verifyBlocksSanityChecks if empty blocks
  if (!lastBlock) {
    throw Error("Empty partiallyVerifiedBlocks");
  }

  // For a block with SYNCING status (called optimistic block), it's okay to import with
  // SYNCING status as EL could switch into syncing
  //
  // 1. On initial startup/restart
  // 2. When some reorg might have occurred and EL doesn't has a parent root
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
  //
  // When to import such blocks:
  // From: https://github.com/ethereum/consensus-specs/pull/2844
  for (let blockIndex = 0; blockIndex < blockInputs.length; blockIndex++) {
    const blockInput = blockInputs[blockIndex];
    // If blocks are invalid in consensus the main promise could resolve before this loop ends.
    // In that case stop sending blocks to execution engine
    if (signal.aborted) {
      throw new ErrorAborted("verifyBlockExecutionPayloads");
    }
    const verifyResponse = await verifyBlockExecutionPayload(chain, blockInput, preState0);

    // If execError has happened, then we need to extract the segmentExecStatus and return
    if (verifyResponse.execError !== null) {
      return getSegmentErrorResponse({verifyResponse, blockIndex}, parentBlock, blockInputs);
    }

    // If we are here then its because executionStatus is one of MaybeValidExecutionStatus
    const {executionStatus} = verifyResponse;
    executionStatuses.push(executionStatus);
  }

  const executionTime = Date.now();
  if (
    blockInputs.length === 1 &&
    opts.seenTimestampSec !== undefined &&
    executionStatuses[0] === ExecutionStatus.Valid
  ) {
    const recvToValidation = executionTime / 1000 - opts.seenTimestampSec;
    const validationTime = recvToValidation - recvToValLatency;

    chain.metrics?.gossipBlock.executionPayload.recvToValidation.observe(recvToValidation);
    chain.metrics?.gossipBlock.executionPayload.validationTime.observe(validationTime);

    chain.logger.debug("Verified execution payload", {
      slot: blockInputs[0].slot,
      recvToValLatency,
      recvToValidation,
      validationTime,
    });
  }

  return {
    execAborted: null,
    executionStatuses,
    executionTime,
  };
}

/**
 * Verifies a single block execution payload by sending it to the EL client (via HTTP).
 */
export async function verifyBlockExecutionPayload(
  chain: VerifyBlockExecutionPayloadModules,
  blockInput: IBlockInput,
  preState0: CachedBeaconStateAllForks
): Promise<VerifyBlockExecutionResponse> {
  const block = blockInput.getBlock();
  /** Not null if execution is enabled */
  const executionPayloadEnabled =
    isExecutionStateType(preState0) &&
    isExecutionBlockBodyType(block.message.body) &&
    isExecutionEnabled(preState0, block.message)
      ? block.message.body.executionPayload
      : null;

  if (!executionPayloadEnabled) {
    // Pre-merge block, no execution payload to verify
    return {executionStatus: ExecutionStatus.PreMerge, lvhResponse: undefined, execError: null};
  }

  // TODO: Handle better notifyNewPayload() returning error is syncing
  const fork = blockInput.forkName;
  const versionedHashes =
    isBlockInputBlobs(blockInput) || isBlockInputColumns(blockInput) ? blockInput.getVersionedHashes() : undefined;
  const parentBlockRoot = ForkSeq[fork] >= ForkSeq.deneb ? block.message.parentRoot : undefined;
  const executionRequests =
    ForkSeq[fork] >= ForkSeq.electra ? (block.message.body as electra.BeaconBlockBody).executionRequests : undefined;

  const logCtx = {slot: blockInput.slot, executionBlock: executionPayloadEnabled.blockNumber};
  chain.logger.debug("Call engine api newPayload", logCtx);
  const execResult = await chain.executionEngine.notifyNewPayload(
    fork,
    executionPayloadEnabled,
    versionedHashes,
    parentBlockRoot,
    executionRequests
  );
  chain.logger.debug("Receive engine api newPayload result", {...logCtx, status: execResult.status});

  chain.metrics?.engineNotifyNewPayloadResult.inc({result: execResult.status});

  switch (execResult.status) {
    case ExecutionPayloadStatus.VALID: {
      const executionStatus: ExecutionStatus.Valid = ExecutionStatus.Valid;
      const lvhResponse = {executionStatus, latestValidExecHash: execResult.latestValidHash};
      return {executionStatus, lvhResponse, execError: null};
    }

    case ExecutionPayloadStatus.INVALID: {
      const executionStatus: ExecutionStatus.Invalid = ExecutionStatus.Invalid;
      const lvhResponse = {
        executionStatus,
        latestValidExecHash: execResult.latestValidHash,
        invalidateFromParentBlockRoot: blockInput.parentRootHex,
      };
      const execError = new BlockError(block, {
        code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
        execStatus: execResult.status,
        errorMessage: execResult.validationError ?? "",
      });
      return {executionStatus, lvhResponse, execError};
    }

    // Accepted and Syncing have the same treatment, as final validation of block is pending
    // Post-merge, we're always safe to optimistically import
    case ExecutionPayloadStatus.ACCEPTED:
    case ExecutionPayloadStatus.SYNCING:
      return {executionStatus: ExecutionStatus.Syncing, execError: null};

    // If the block has is not valid, or it referenced an invalid terminal block then the
    // block is invalid, however it has no bearing on any forkChoice cleanup
    //
    // There can be other reasons for which EL failed some of the observed ones are
    // 1. Connection refused / can't connect to EL port
    // 2. EL Internal Error
    // 3. Geth sometimes gives invalid merkle root error which means invalid
    //    but expects it to be handled in CL as of now. But we should log as warning
    //    and give it as optimistic treatment and expect any other non-geth CL<>EL
    //    combination to reject the invalid block and propose a block.
    //    On kintsugi devnet, this has been observed to cause contiguous proposal failures
    //    as the network is geth dominated, till a non geth node proposes and moves network
    //    forward
    // For network/unreachable errors, an optimization can be added to replay these blocks
    // back. But for now, lets assume other mechanisms like unknown parent block of a future
    // child block will cause it to replay

    case ExecutionPayloadStatus.INVALID_BLOCK_HASH:
    case ExecutionPayloadStatus.ELERROR:
    case ExecutionPayloadStatus.UNAVAILABLE: {
      const execError = new BlockError(block, {
        code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
        execStatus: execResult.status,
        errorMessage: execResult.validationError,
      });
      return {executionStatus: null, execError} as VerifyBlockExecutionResponse;
    }
  }
}

function getSegmentErrorResponse(
  {verifyResponse, blockIndex}: {verifyResponse: VerifyExecutionErrorResponse; blockIndex: number},
  parentBlock: ProtoBlock,
  blocks: IBlockInput[]
): SegmentExecStatus {
  const {executionStatus, lvhResponse, execError} = verifyResponse;
  let invalidSegmentLVH: LVHInvalidResponse | undefined = undefined;

  if (
    executionStatus === ExecutionStatus.Invalid &&
    lvhResponse !== undefined &&
    lvhResponse.latestValidExecHash !== null
  ) {
    let lvhFound = false;
    for (let mayBeLVHIndex = blockIndex - 1; mayBeLVHIndex >= 0; mayBeLVHIndex--) {
      const block = blocks[mayBeLVHIndex].getBlock();
      if (
        toRootHex((block.message.body as bellatrix.BeaconBlockBody).executionPayload.blockHash) ===
        lvhResponse.latestValidExecHash
      ) {
        lvhFound = true;
        break;
      }
    }

    // If there is no valid in the segment then we have to propagate invalid response
    // in forkchoice as well if
    //  - if the parentBlock is also not the lvh
    //  - and parentBlock is not pre merge
    if (
      !lvhFound &&
      parentBlock.executionStatus !== ExecutionStatus.PreMerge &&
      parentBlock.executionPayloadBlockHash !== lvhResponse.latestValidExecHash
    ) {
      invalidSegmentLVH = {
        executionStatus: ExecutionStatus.Invalid,
        latestValidExecHash: lvhResponse.latestValidExecHash,
        invalidateFromParentBlockRoot: parentBlock.blockRoot,
      };
    }
  }
  const execAborted = {blockIndex, execError};
  return {execAborted, invalidSegmentLVH} as SegmentExecStatus;
}
