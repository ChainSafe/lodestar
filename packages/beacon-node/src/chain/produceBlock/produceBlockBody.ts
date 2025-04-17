import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkPostBellatrix, ForkSeq, isForkPostBellatrix} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateBellatrix,
  CachedBeaconStateCapella,
  CachedBeaconStateExecutions,
  computeTimeAtSlot,
  getCurrentEpoch,
  getExpectedWithdrawals,
  getRandaoMix,
  isMergeTransitionComplete,
} from "@lodestar/state-transition";
import {
  BLSPubkey,
  BLSSignature,
  BeaconBlockBody,
  BlindedBeaconBlock,
  BlindedBeaconBlockBody,
  Bytes32,
  ExecutionPayloadHeader,
  Root,
  RootHex,
  SSEPayloadAttributes,
  Slot,
  Wei,
  bellatrix,
  capella,
  deneb,
  electra,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {Logger, gweiToWei, sleep, toHex, toPubkeyHex, toRootHex} from "@lodestar/utils";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../constants/index.js";
import {IEth1ForBlockProduction} from "../../eth1/index.js";
import {numToQuantity} from "../../eth1/provider/utils.js";
import {
  IExecutionBuilder,
  IExecutionEngine,
  PayloadAttributes,
  PayloadId,
  getExpectedGasLimit,
} from "../../execution/index.js";
import {BeaconChain} from "../chain.js";
import {
  AssembledBlindedBlock,
  AssembledBlindedBlockBody,
  AssembledBlockBodyResponse,
  AssembledBlockResponse,
  AssembledFullBlock,
  AssembledFullBlockBody,
  BlobsResult,
  BlobsResultType,
  BlockType,
  CommonBlockBody,
  ProduceBlockBodyAttrs,
} from "../interface.js";
import {computeNewStateRoot} from "./computeNewStateRoot.js";
import {validateBlobsAndKzgCommitments} from "./validateBlobsAndKzgCommitments.js";

// Time to provide the EL to generate a payload from new payload id
const PAYLOAD_GENERATION_TIME_MS = 500;

export enum PayloadPreparationType {
  Fresh = "Fresh",
  Cached = "Cached",
  Reorged = "Reorged",
  Blinded = "Blinded",
}

/**
 * Block production steps tracked in metrics
 */
export enum BlockProductionStep {
  proposerSlashing = "proposerSlashing",
  attesterSlashings = "attesterSlashings",
  voluntaryExits = "voluntaryExits",
  blsToExecutionChanges = "blsToExecutionChanges",
  attestations = "attestations",
  eth1DataAndDeposits = "eth1DataAndDeposits",
  syncAggregate = "syncAggregate",
  executionPayload = "executionPayload",
}

export type BlockAttributes = {
  randaoReveal: BLSSignature;
  graffiti: Bytes32;
  slot: Slot;
  parentBlockRoot: Root;
  feeRecipient?: string;
};

export async function produceBlindedBlockBody(
  this: BeaconChain,
  currentState: CachedBeaconStateAllForks,
  blockAttr: ProduceBlockBodyAttrs
): Promise<AssembledBlockBodyResponse<BlockType.Blinded>> {
  const {slot, proposerIndex, feeRecipient: requestedFeeRecipient, parentBlockRoot, proposerPubKey} = blockAttr;
  const fork = currentState.config.getForkName(slot);
  const endExecutionPayload = this.metrics?.builderBlockProductionTimeSteps?.startTimer();
  const blockBody = {} as AssembledBlindedBlockBody;

  // Type-safe for blobs variable. Translate 'null' value into 'preDeneb' enum
  // TODO: Not ideal, but better than just using null.
  // TODO: Does not guarantee that preDeneb enum goes with a preDeneb block
  let blobsResult: BlobsResult = {type: BlobsResultType.preDeneb};
  let executionPayloadValue: Wei = BigInt(0);

  const logMeta: Record<string, string | number | bigint> = {
    fork,
    blockType: BlockType.Blinded,
    slot,
  };

  if (isForkPostBellatrix(fork)) {
    if (!this.executionBuilder) throw Error("Execution Builder not available");

    const safeBlockHash = this.forkChoice.getJustifiedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    const finalizedBlockHash = this.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    const feeRecipient = requestedFeeRecipient ?? this.beaconProposerCache.getOrDefault(proposerIndex);
    const feeRecipientType = requestedFeeRecipient
      ? "requested"
      : this.beaconProposerCache.get(proposerIndex)
        ? "cached"
        : "default";

    Object.assign(logMeta, {feeRecipientType, feeRecipient});

    // This path will not be used in the production, but is here just for merge mock
    // tests because merge-mock requires an fcU to be issued prior to fetch payload
    // header.
    if (this.executionBuilder.issueLocalFcUWithFeeRecipient !== undefined) {
      await prepareExecutionPayload(
        this,
        this.logger,
        fork,
        parentBlockRoot,
        safeBlockHash,
        finalizedBlockHash ?? ZERO_HASH_HEX,
        currentState as CachedBeaconStateBellatrix,
        this.executionBuilder.issueLocalFcUWithFeeRecipient
      );
    }

    // For MeV boost integration, this is where the execution header will be
    // fetched from the payload id and a blinded block will be produced instead of
    // full block for the validator to sign
    const builderRes = await prepareExecutionPayloadHeader(
      this,
      fork,
      currentState as CachedBeaconStateBellatrix,
      proposerPubKey
    );

    endExecutionPayload?.({
      step: BlockProductionStep.executionPayload,
    });

    const {header: executionPayloadHeader, blobKzgCommitments, executionRequests} = builderRes;

    executionPayloadValue = builderRes.executionPayloadValue;
    (blockBody as BlindedBeaconBlockBody).executionPayloadHeader = executionPayloadHeader;
    Object.assign(logMeta, {executionPayloadValue});

    const fetchedTime = Date.now() / 1000 - computeTimeAtSlot(this.config, slot, this.genesisTime);
    const prepType = PayloadPreparationType.Blinded;
    this.metrics?.blockPayload.payloadFetchedTime.observe({prepType}, fetchedTime);
    this.logger.verbose("Fetched execution payload header from builder", {
      slot,
      executionPayloadValue,
      prepType,
      fetchedTime,
    });

    const targetGasLimit = this.executionBuilder.getValidatorRegistration(proposerPubKey)?.gasLimit;

    if (!targetGasLimit) {
      // This should only happen if cache was cleared due to restart of beacon node
      this.logger.warn("Failed to get validator registration, could not check header gas limit", {
        slot,
        proposerIndex,
        proposerPubKey: toPubkeyHex(proposerPubKey),
      });
    } else {
      const headerGasLimit = builderRes.header.gasLimit;
      const parentGasLimit = (currentState as CachedBeaconStateBellatrix).latestExecutionPayloadHeader.gasLimit;
      const expectedGasLimit = getExpectedGasLimit(parentGasLimit, targetGasLimit);

      const lowerBound = Math.min(parentGasLimit, expectedGasLimit);
      const upperBound = Math.max(parentGasLimit, expectedGasLimit);

      if (headerGasLimit < lowerBound || headerGasLimit > upperBound) {
        throw Error(`Header gas limit ${headerGasLimit} is outside of acceptable range [${lowerBound}, ${upperBound}]`);
      }

      if (headerGasLimit !== expectedGasLimit) {
        this.logger.warn("Header gas limit does not match expected value", {
          slot,
          headerGasLimit,
          expectedGasLimit,
          parentGasLimit,
          targetGasLimit,
        });
      }
    }

    if (ForkSeq[fork] >= ForkSeq.deneb) {
      if (blobKzgCommitments === undefined) {
        throw Error(`Invalid builder getHeader response for fork=${fork}, missing blobKzgCommitments`);
      }

      (blockBody as AssembledBlindedBlockBody<ForkName.deneb>).blobKzgCommitments = blobKzgCommitments;
      blobsResult = {type: BlobsResultType.blinded};
      Object.assign(logMeta, {blobs: blobKzgCommitments.length});
    }

    if (ForkSeq[fork] >= ForkSeq.electra) {
      if (executionRequests === undefined) {
        throw Error(`Invalid builder getHeader response for fork=${fork}, missing executionRequests`);
      }

      (blockBody as AssembledBlindedBlockBody<ForkName.electra>).executionRequests = executionRequests;
      Object.assign(logMeta, {
        executionRequests: {
          consolidations: executionRequests.consolidations.length,
          deposits: executionRequests.deposits.length,
          withdrawals: executionRequests.withdrawals.length,
        },
      });
    }
  }

  endExecutionPayload?.({
    step: BlockProductionStep.executionPayload,
  });

  this.logger.verbose("Produced beacon block body", logMeta);

  return {
    body: blockBody,
    blobs: blobsResult,
    executionPayloadValue,
    shouldOverrideBuilder: undefined,
  };
}

export async function produceFullBlockBody(
  this: BeaconChain,
  currentState: CachedBeaconStateAllForks,
  blockAttr: ProduceBlockBodyAttrs
): Promise<AssembledBlockBodyResponse<BlockType.Full>> {
  const {slot, proposerIndex, feeRecipient: requestedFeeRecipient, parentBlockRoot} = blockAttr;
  const fork = currentState.config.getForkName(slot);
  const endExecutionPayload = this.metrics?.builderBlockProductionTimeSteps?.startTimer();
  const blockBody = {} as AssembledFullBlockBody;

  // Type-safe for blobs variable. Translate 'null' value into 'preDeneb' enum
  // TODO: Not ideal, but better than just using null.
  // TODO: Does not guarantee that preDeneb enum goes with a preDeneb block
  let blobsResult: BlobsResult = {type: BlobsResultType.preDeneb};
  // even though shouldOverrideBuilder is relevant for the engine response, for simplicity of typing
  // we just return it undefined for the builder which anyway doesn't get consumed downstream
  let shouldOverrideBuilder: boolean | undefined;
  let executionPayloadValue: Wei = BigInt(0);

  const logMeta: Record<string, string | number | bigint> = {
    fork,
    blockType: BlockType.Full,
    slot,
  };

  if (isForkPostBellatrix(fork)) {
    const safeBlockHash = this.forkChoice.getJustifiedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    const finalizedBlockHash = this.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    const feeRecipient = requestedFeeRecipient ?? this.beaconProposerCache.getOrDefault(proposerIndex);
    const feeRecipientType = requestedFeeRecipient
      ? "requested"
      : this.beaconProposerCache.get(proposerIndex)
        ? "cached"
        : "default";

    Object.assign(logMeta, {feeRecipientType, feeRecipient});

    // try catch payload fetch here, because there is still a recovery path possible if we
    // are pre-merge. We don't care the same for builder segment as the execution block
    // will takeover if the builder flow was activated and errors
    try {
      // https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md#constructing-the-beaconblockbody
      const prepareRes = await prepareExecutionPayload(
        this,
        this.logger,
        fork,
        parentBlockRoot,
        safeBlockHash,
        finalizedBlockHash ?? ZERO_HASH_HEX,
        currentState as CachedBeaconStateExecutions,
        feeRecipient
      );

      if (prepareRes.isPremerge) {
        (blockBody as AssembledFullBlockBody<ForkName.bellatrix>).executionPayload =
          sszTypesFor(fork).ExecutionPayload.defaultValue();
        blobsResult = {type: BlobsResultType.preDeneb};
        executionPayloadValue = BigInt(0);
      } else {
        const {prepType, payloadId} = prepareRes;
        Object.assign(logMeta, {executionPayloadPrepType: prepType});

        if (prepType !== PayloadPreparationType.Cached) {
          // Wait for 500ms to allow EL to add some txs to the payload
          // the pitfalls of this have been put forward here, but 500ms delay for block proposal
          // seems marginal even with unhealthy network
          //
          // See: https://discord.com/channels/595666850260713488/892088344438255616/1009882079632314469
          await sleep(PAYLOAD_GENERATION_TIME_MS);
        }

        const engineRes = await this.executionEngine.getPayload(fork, payloadId);
        const {executionPayload, blobsBundle, executionRequests} = engineRes;
        shouldOverrideBuilder = engineRes.shouldOverrideBuilder;

        (blockBody as BeaconBlockBody<ForkPostBellatrix>).executionPayload = executionPayload;
        executionPayloadValue = engineRes.executionPayloadValue;
        Object.assign(logMeta, {transactions: executionPayload.transactions.length, shouldOverrideBuilder});

        const fetchedTime = Date.now() / 1000 - computeTimeAtSlot(this.config, slot, this.genesisTime);
        this.metrics?.blockPayload.payloadFetchedTime.observe({prepType}, fetchedTime);
        this.logger.verbose("Fetched execution payload from engine", {
          slot,
          executionPayloadValue,
          prepType,
          payloadId,
          fetchedTime,
          executionHeadBlockHash: toRootHex(engineRes.executionPayload.blockHash),
        });
        if (executionPayload.transactions.length === 0) {
          this.metrics?.blockPayload.emptyPayloads.inc({prepType});
        }

        if (ForkSeq[fork] >= ForkSeq.deneb) {
          if (blobsBundle === undefined) {
            throw Error(`Missing blobsBundle response from getPayload at fork=${fork}`);
          }

          if (this.opts.sanityCheckExecutionEngineBlobs) {
            validateBlobsAndKzgCommitments(executionPayload, blobsBundle);
          }

          (blockBody as deneb.BeaconBlockBody).blobKzgCommitments = blobsBundle.commitments;
          const blockHash = toRootHex(executionPayload.blockHash);
          const contents = {kzgProofs: blobsBundle.proofs, blobs: blobsBundle.blobs};
          blobsResult = {type: BlobsResultType.produced, contents, blockHash};

          Object.assign(logMeta, {blobs: blobsBundle.commitments.length});
        } else {
          blobsResult = {type: BlobsResultType.preDeneb};
        }

        if (ForkSeq[fork] >= ForkSeq.electra) {
          if (executionRequests === undefined) {
            throw Error(`Missing executionRequests response from getPayload at fork=${fork}`);
          }
          (blockBody as electra.BeaconBlockBody).executionRequests = executionRequests;
        }
      }
    } catch (e) {
      this.metrics?.blockPayload.payloadFetchErrors.inc();
      // ok we don't have an execution payload here, so we can assign an empty one
      // if pre-merge

      if (!isMergeTransitionComplete(currentState as CachedBeaconStateBellatrix)) {
        this.logger?.warn(
          "Fetch payload from the execution failed, however since we are still pre-merge proceeding with an empty one.",
          {},
          e as Error
        );
        (blockBody as BeaconBlockBody<ForkPostBellatrix>).executionPayload =
          sszTypesFor(fork).ExecutionPayload.defaultValue();
        blobsResult = {type: BlobsResultType.preDeneb};
        executionPayloadValue = BigInt(0);
      } else {
        // since merge transition is complete, we need a valid payload even if with an
        // empty (transactions) one. defaultValue isn't gonna cut it!
        throw e;
      }
    }
  }

  endExecutionPayload?.({
    step: BlockProductionStep.executionPayload,
  });

  // Withdrawals are only available in full body
  if (ForkSeq[fork] >= ForkSeq.capella) {
    Object.assign(logMeta, {
      withdrawals: (blockBody as capella.BeaconBlockBody).executionPayload.withdrawals.length,
    });
  }

  Object.assign(logMeta, {executionPayloadValue});
  this.logger.verbose("Produced beacon block body", logMeta);

  return {
    body: blockBody,
    blobs: blobsResult,
    executionPayloadValue,
    shouldOverrideBuilder,
  };
}

export async function assembleBlockBodyToBlock<T extends BlockType>(
  this: BeaconChain,
  opts: {
    blockType: T;
    currentState: CachedBeaconStateAllForks;
    blockAttributes: BlockAttributes;
    commonBlockBody: CommonBlockBody;
    assembledBlockBody: AssembledBlockBodyResponse<T>;
  }
): Promise<AssembledBlockResponse<T>> {
  const {blockType, blockAttributes, currentState, commonBlockBody, assembledBlockBody} = opts;
  const {slot, parentBlockRoot} = blockAttributes;
  const {blobs, executionPayloadValue, shouldOverrideBuilder} = assembledBlockBody;
  const proposerIndex = currentState.epochCtx.getBeaconProposer(slot);

  const body = {
    ...commonBlockBody,
    ...assembledBlockBody.body,
  };

  // The hashtree root computed here for debug log will get cached and hence won't introduce additional delays
  const bodyRoot =
    blockType === BlockType.Full
      ? this.config.getForkTypes(slot).BeaconBlockBody.hashTreeRoot(body)
      : this.config.getPostBellatrixForkTypes(slot).BlindedBeaconBlockBody.hashTreeRoot(body as BlindedBeaconBlockBody);
  this.logger.debug("Computing block post state from the produced body", {
    slot,
    bodyRoot: toRootHex(bodyRoot),
    blockType,
  });

  const block = {
    slot,
    proposerIndex,
    parentRoot: parentBlockRoot,
    stateRoot: ZERO_HASH,
    body,
  } as AssembledBlindedBlock | AssembledFullBlock;

  const {newStateRoot, proposerReward} = computeNewStateRoot(this.metrics, currentState, block);
  block.stateRoot = newStateRoot;
  const blockRoot =
    blockType === BlockType.Full
      ? this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block)
      : this.config.getPostBellatrixForkTypes(slot).BlindedBeaconBlock.hashTreeRoot(block as BlindedBeaconBlock);
  const blockRootHex = toRootHex(blockRoot);

  // track the produced block for consensus broadcast validations
  if (blockType === BlockType.Full) {
    this.logger.debug("Setting executionPayload cache for produced block", {blockRootHex, slot, blockType});
    this.producedBlockRoot.set(blockRootHex, (block as bellatrix.BeaconBlock).body.executionPayload ?? null);
    this.metrics?.blockProductionCaches.producedBlockRoot.set(this.producedBlockRoot.size);
  } else {
    this.logger.debug("Tracking the produced blinded block", {blockRootHex, slot, blockType});
    this.producedBlindedBlockRoot.add(blockRootHex);
    this.metrics?.blockProductionCaches.producedBlindedBlockRoot.set(this.producedBlindedBlockRoot.size);
  }

  // Cache for latter broadcasting
  //
  // blinded blobs will be fetched and added to this cache later before finally
  // publishing the blinded block's full version
  if (blobs.type === BlobsResultType.produced) {
    // body is of full type here
    const {blockHash, contents} = blobs;
    this.producedContentsCache.set(blockHash, contents);
    this.metrics?.blockProductionCaches.producedContentsCache.set(this.producedContentsCache.size);
  }

  if (blockType === BlockType.Blinded) {
    return {
      block,
      executionPayloadValue,
      consensusBlockValue: gweiToWei(proposerReward),
    } as AssembledBlockResponse<T>;
  }

  return {
    block,
    executionPayloadValue,
    consensusBlockValue: gweiToWei(proposerReward),
    shouldOverrideBuilder,
  } as AssembledBlockResponse<T>;
}

/**
 * Produce ExecutionPayload for pre-merge, merge, and post-merge.
 *
 * Expects `eth1MergeBlockFinder` to be actively searching for blocks well in advance to being called.
 *
 * @returns PayloadId = pow block found, null = pow NOT found
 */
export async function prepareExecutionPayload(
  chain: {
    eth1: IEth1ForBlockProduction;
    executionEngine: IExecutionEngine;
    config: ChainForkConfig;
  },
  logger: Logger,
  fork: ForkPostBellatrix,
  parentBlockRoot: Root,
  safeBlockHash: RootHex,
  finalizedBlockHash: RootHex,
  state: CachedBeaconStateExecutions,
  suggestedFeeRecipient: string
): Promise<{isPremerge: true} | {isPremerge: false; prepType: PayloadPreparationType; payloadId: PayloadId}> {
  const parentHashRes = await getExecutionPayloadParentHash(chain, state);
  if (parentHashRes.isPremerge) {
    // Return null only if the execution is pre-merge
    return {isPremerge: true};
  }

  const {parentHash} = parentHashRes;
  const timestamp = computeTimeAtSlot(chain.config, state.slot, state.genesisTime);
  const prevRandao = getRandaoMix(state, state.epochCtx.epoch);

  const payloadIdCached = chain.executionEngine.payloadIdCache.get({
    headBlockHash: toRootHex(parentHash),
    finalizedBlockHash,
    timestamp: numToQuantity(timestamp),
    prevRandao: toHex(prevRandao),
    suggestedFeeRecipient,
  });

  // prepareExecutionPayload will throw error via notifyForkchoiceUpdate if
  // the EL returns Syncing on this request to prepare a payload
  // TODO: Handle only this case, DO NOT put a generic try / catch that discards all errors
  let payloadId: PayloadId | null;
  let prepType: PayloadPreparationType;

  if (payloadIdCached) {
    payloadId = payloadIdCached;
    prepType = PayloadPreparationType.Cached;
  } else {
    // If there was a payload assigned to this timestamp, it would imply that there some sort
    // of payload reorg, i.e. head, fee recipient or any other fcu param changed
    if (chain.executionEngine.payloadIdCache.hasPayload({timestamp: numToQuantity(timestamp)})) {
      prepType = PayloadPreparationType.Reorged;
    } else {
      prepType = PayloadPreparationType.Fresh;
    }

    const attributes: PayloadAttributes = preparePayloadAttributes(fork, chain, {
      prepareState: state,
      prepareSlot: state.slot,
      parentBlockRoot,
      feeRecipient: suggestedFeeRecipient,
    });

    payloadId = await chain.executionEngine.notifyForkchoiceUpdate(
      fork,
      toRootHex(parentHash),
      safeBlockHash,
      finalizedBlockHash,
      attributes
    );
    logger.verbose("Prepared payload id from execution engine", {payloadId});
  }

  // Should never happen, notifyForkchoiceUpdate() with payload attributes always
  // returns payloadId
  if (payloadId === null) {
    throw Error("notifyForkchoiceUpdate returned payloadId null");
  }

  // We are only returning payloadId here because prepareExecutionPayload is also called from
  // prepareNextSlot, which is an advance call to execution engine to start building payload
  // Actual payload isn't produced till getPayload is called.
  return {isPremerge: false, payloadId, prepType};
}

async function prepareExecutionPayloadHeader(
  chain: {
    eth1: IEth1ForBlockProduction;
    executionBuilder?: IExecutionBuilder;
    config: ChainForkConfig;
  },
  fork: ForkPostBellatrix,
  state: CachedBeaconStateBellatrix,
  proposerPubKey: BLSPubkey
): Promise<{
  header: ExecutionPayloadHeader;
  executionPayloadValue: Wei;
  blobKzgCommitments?: deneb.BlobKzgCommitments;
  executionRequests?: electra.ExecutionRequests;
}> {
  if (!chain.executionBuilder) {
    throw Error("executionBuilder required");
  }

  const parentHashRes = await getExecutionPayloadParentHash(chain, state);
  if (parentHashRes.isPremerge) {
    throw Error("Execution builder disabled pre-merge");
  }

  const {parentHash} = parentHashRes;
  return chain.executionBuilder.getHeader(fork, state.slot, parentHash, proposerPubKey);
}

export async function getExecutionPayloadParentHash(
  chain: {
    eth1: IEth1ForBlockProduction;
    config: ChainForkConfig;
  },
  state: CachedBeaconStateExecutions
): Promise<{isPremerge: true} | {isPremerge: false; parentHash: Root}> {
  // Use different POW block hash parent for block production based on merge status.
  // Returned value of null == using an empty ExecutionPayload value
  if (isMergeTransitionComplete(state)) {
    // Post-merge, normal payload
    return {isPremerge: false, parentHash: state.latestExecutionPayloadHeader.blockHash};
  }

  if (
    !ssz.Root.equals(chain.config.TERMINAL_BLOCK_HASH, ZERO_HASH) &&
    getCurrentEpoch(state) < chain.config.TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH
  ) {
    throw new Error(
      `InvalidMergeTBH epoch: expected >= ${
        chain.config.TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH
      }, actual: ${getCurrentEpoch(state)}`
    );
  }

  const terminalPowBlockHash = await chain.eth1.getTerminalPowBlock();
  if (terminalPowBlockHash === null) {
    // Pre-merge, no prepare payload call is needed
    return {isPremerge: true};
  }
  // Signify merge via producing on top of the last PoW block
  return {isPremerge: false, parentHash: terminalPowBlockHash};
}

export async function getPayloadAttributesForSSE(
  fork: ForkPostBellatrix,
  chain: {
    eth1: IEth1ForBlockProduction;
    config: ChainForkConfig;
  },
  {
    prepareState,
    prepareSlot,
    parentBlockRoot,
    feeRecipient,
  }: {prepareState: CachedBeaconStateExecutions; prepareSlot: Slot; parentBlockRoot: Root; feeRecipient: string}
): Promise<SSEPayloadAttributes> {
  const parentHashRes = await getExecutionPayloadParentHash(chain, prepareState);

  if (!parentHashRes.isPremerge) {
    const {parentHash} = parentHashRes;
    const payloadAttributes = preparePayloadAttributes(fork, chain, {
      prepareState,
      prepareSlot,
      parentBlockRoot,
      feeRecipient,
    });

    const ssePayloadAttributes: SSEPayloadAttributes = {
      proposerIndex: prepareState.epochCtx.getBeaconProposer(prepareSlot),
      proposalSlot: prepareSlot,
      parentBlockNumber: prepareState.latestExecutionPayloadHeader.blockNumber,
      parentBlockRoot,
      parentBlockHash: parentHash,
      payloadAttributes,
    };
    return ssePayloadAttributes;
  }

  throw Error("The execution is still pre-merge");
}

function preparePayloadAttributes(
  fork: ForkPostBellatrix,
  chain: {
    config: ChainForkConfig;
  },
  {
    prepareState,
    prepareSlot,
    parentBlockRoot,
    feeRecipient,
  }: {
    prepareState: CachedBeaconStateExecutions;
    prepareSlot: Slot;
    parentBlockRoot: Root;
    feeRecipient: string;
  }
): SSEPayloadAttributes["payloadAttributes"] {
  const timestamp = computeTimeAtSlot(chain.config, prepareSlot, prepareState.genesisTime);
  const prevRandao = getRandaoMix(prepareState, prepareState.epochCtx.epoch);
  const payloadAttributes = {
    timestamp,
    prevRandao,
    suggestedFeeRecipient: feeRecipient,
  };

  if (ForkSeq[fork] >= ForkSeq.capella) {
    // withdrawals logic is now fork aware as it changes on electra fork post capella
    (payloadAttributes as capella.SSEPayloadAttributes["payloadAttributes"]).withdrawals = getExpectedWithdrawals(
      ForkSeq[fork],
      prepareState as CachedBeaconStateCapella
    ).withdrawals;
  }

  if (ForkSeq[fork] >= ForkSeq.deneb) {
    (payloadAttributes as deneb.SSEPayloadAttributes["payloadAttributes"]).parentBeaconBlockRoot = parentBlockRoot;
  }

  return payloadAttributes;
}

export async function produceCommonBlockBody<T extends BlockType>(
  this: BeaconChain,
  blockType: T,
  currentState: CachedBeaconStateAllForks,
  {
    randaoReveal,
    graffiti,
    slot,
    parentSlot,
    parentBlockRoot,
  }: BlockAttributes & {
    parentSlot: Slot;
  }
): Promise<CommonBlockBody> {
  const stepsMetrics =
    blockType === BlockType.Full
      ? this.metrics?.executionBlockProductionTimeSteps
      : this.metrics?.builderBlockProductionTimeSteps;

  const fork = currentState.config.getForkName(slot);

  // TODO:
  // Iterate through the naive aggregation pool and ensure all the attestations from there
  // are included in the operation pool.
  // for (const attestation of db.attestationPool.getAll()) {
  //   try {
  //     opPool.insertAttestation(attestation);
  //   } catch (e) {
  //     // Don't stop block production if there's an error, just create a log.
  //     logger.error("Attestation did not transfer to op pool", {}, e);
  //   }
  // }
  const [attesterSlashings, proposerSlashings, voluntaryExits, blsToExecutionChanges] =
    this.opPool.getSlashingsAndExits(currentState, blockType, this.metrics);

  const endAttestations = stepsMetrics?.startTimer();
  const attestations = this.aggregatedAttestationPool.getAttestationsForBlock(fork, this.forkChoice, currentState);
  endAttestations?.({
    step: BlockProductionStep.attestations,
  });

  const endEth1DataAndDeposits = stepsMetrics?.startTimer();
  const {eth1Data, deposits} = await this.eth1.getEth1DataAndDeposits(currentState);
  endEth1DataAndDeposits?.({
    step: BlockProductionStep.eth1DataAndDeposits,
  });

  const blockBody: Omit<CommonBlockBody, "blsToExecutionChanges" | "syncAggregate"> = {
    randaoReveal,
    graffiti,
    eth1Data,
    proposerSlashings,
    attesterSlashings,
    attestations,
    deposits,
    voluntaryExits,
  };

  if (ForkSeq[fork] >= ForkSeq.capella) {
    (blockBody as CommonBlockBody).blsToExecutionChanges = blsToExecutionChanges;
  }

  const endSyncAggregate = stepsMetrics?.startTimer();
  if (ForkSeq[fork] >= ForkSeq.altair) {
    const syncAggregate = this.syncContributionAndProofPool.getAggregate(parentSlot, parentBlockRoot);
    this.metrics?.production.producedSyncAggregateParticipants.observe(
      syncAggregate.syncCommitteeBits.getTrueBitIndexes().length
    );
    (blockBody as CommonBlockBody).syncAggregate = syncAggregate;
  }
  endSyncAggregate?.({
    step: BlockProductionStep.syncAggregate,
  });

  return blockBody as CommonBlockBody;
}
