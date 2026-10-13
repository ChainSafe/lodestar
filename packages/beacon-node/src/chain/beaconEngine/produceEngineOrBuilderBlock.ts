import {routes} from "@lodestar/api";
import {ProtoBlock} from "@lodestar/fork-choice";
import {
  BUILDER_INDEX_SELF_BUILD,
  ForkPostBellatrix,
  ForkPostDeneb,
  ForkPreDeneb,
  ForkPreGloas,
  ForkSeq,
  isForkPostBellatrix,
  isForkPostDeneb,
  isForkPostGloas,
} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {
  BLSSignature,
  BeaconBlock,
  BlindedBeaconBlock,
  BlockContents,
  Bytes32,
  ProducedBlockSource,
  Slot,
  Wei,
  bellatrix,
  gloas,
} from "@lodestar/types";
import {
  GWEI_TO_WEI,
  TimeoutError,
  defer,
  formatWeiToEth,
  fromHex,
  prettyGweiToEth,
  prettyWeiToEth,
  resolveOrRacePromises,
  sleep,
  toHex,
  toPrintableUrl,
  toRootHex,
} from "@lodestar/utils";
import {MAX_BUILDER_BOOST_FACTOR} from "@lodestar/validator";
import {ApiError, NodeIsSyncing} from "../../api/impl/errors.js";
import {selectBlockProductionSource, selectBlockProductionSourceByBoostFactor} from "../../api/impl/validator/utils.js";
import {BUILDER_BID_DEADLINE_MS, BuilderApiBid} from "../../execution/builder/apiClient.js";
import {BuilderStatus, NoBidReceived} from "../../execution/builder/http.js";
import {getBuilderBidTotalGwei, validateBuilderApiExecutionPayloadBid} from "../../execution/builder/validateBid.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {CommonBlockBody} from "../interface.js";
import {PooledExecutionPayloadBid} from "../opPools/index.js";
import {BlockType, ProduceFullDeneb, ProduceFullGloas, ProduceResult} from "../produceBlock/index.js";
import type {BeaconEngine} from "./beaconEngine.js";
import type {ProduceBlockV4Request, ProduceBlockV4Result} from "./interface.js";
import {produceBlindedBlock, produceBlock as produceSelfBlock} from "./produceBlock.js";

/**
 * Cutoff time to wait from start of the slot for execution and builder block production apis to resolve.
 * Post this time, race execution and builder to pick whatever resolves first.
 *
 * Empirically the builder block resolves in ~1 second, and execution block resolves in <500 ms.
 * A cutoff of 1667 BPS (2 seconds for 12s slots) gives enough time and if there are unexpected delays
 * it ensures we publish in time as proposals after the attestation deadline will likely be orphaned
 * due to proposer boost reorg.
 *
 * TODO GLOAS: re-evaluate cutoff timing
 */
const BLOCK_PRODUCTION_RACE_CUTOFF_BPS = 1667;

// [beacon-engine] deviation: selected results include DA artifacts for the facade cache.
type ProduceBlockContentsRes = {executionPayloadValue: Wei; consensusBlockValue: Wei} & {
  data: BlockContents<ForkPreGloas>;
  produceResult: ProduceResult;
  version: ForkPreGloas;
};
type ProduceBlindedBlockRes = {executionPayloadValue: Wei; consensusBlockValue: Wei} & {
  data: BlindedBeaconBlock;
  produceResult: ProduceResult;
  version: ForkPostBellatrix;
};

export type ProduceBlindedBlockOrBlockContentsRes = {
  executionPayloadSource: ProducedBlockSource;
  shouldOverrideBuilder?: boolean;
} & (
  | (ProduceBlockContentsRes & {executionPayloadBlinded: false})
  | (ProduceBlindedBlockRes & {executionPayloadBlinded: true})
);

/**
 * Engine block selection reasons tracked in metrics / logs
 */
export enum EngineBlockSelectionReason {
  BuilderDisabled = "builder_disabled",
  BuilderError = "builder_error",
  BuilderTimeout = "builder_timeout",
  BuilderPending = "builder_pending",
  BuilderNoBid = "builder_no_bid",
  BuilderCircuitBreaker = "builder_circuit_breaker",
  BuilderCensorship = "builder_censorship",
  BlockValue = "block_value",
  EnginePreferred = "engine_preferred",
}

/**
 * Builder block selection reasons tracked in metrics / logs
 */
export enum BuilderBlockSelectionReason {
  EngineDisabled = "engine_disabled",
  EngineError = "engine_error",
  EnginePending = "engine_pending",
  BlockValue = "block_value",
  BuilderPreferred = "builder_preferred",
}

export type BlockSelectionResult =
  | {
      source: ProducedBlockSource.engine;
      reason: EngineBlockSelectionReason;
    }
  | {
      source: ProducedBlockSource.builder;
      reason: BuilderBlockSelectionReason;
    };

/**
 * Runs inside BeaconEngine. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/api/impl/validator/index.ts#getBlockValueLogInfo.
 * Synced through unstable@2593063a82.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
function getBlockValueLogInfo(
  block: {executionPayloadValue: bigint; consensusBlockValue: bigint},
  source?: ProducedBlockSource
): Record<string, string> {
  const executionValue = block.executionPayloadValue;
  const consensusValue = block.consensusBlockValue;
  const totalValue = executionValue + consensusValue;

  if (source == null) {
    return {
      executionPayloadValue: prettyWeiToEth(executionValue),
      consensusBlockValue: prettyWeiToEth(consensusValue),
      blockTotalValue: prettyWeiToEth(totalValue),
    };
  }
  if (source === ProducedBlockSource.builder) {
    return {
      builderExecutionPayloadValue: prettyWeiToEth(executionValue),
      builderConsensusBlockValue: prettyWeiToEth(consensusValue),
      builderBlockTotalValue: prettyWeiToEth(totalValue),
    };
  }
  return {
    engineExecutionPayloadValue: prettyWeiToEth(executionValue),
    engineConsensusBlockValue: prettyWeiToEth(consensusValue),
    engineBlockTotalValue: prettyWeiToEth(totalValue),
  };
}
/**
 * Runs inside BeaconEngine. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/api/impl/validator/index.ts#produceBuilderBlindedBlock.
 * Synced through unstable@2593063a82.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function produceBuilderBlindedBlock(
  this: BeaconEngine,
  slot: Slot,
  randaoReveal: BLSSignature,
  graffiti: Bytes32,
  // as of now fee recipient checks can not be performed because builder does not return bid recipient
  {
    commonBlockBodyPromise,
    parentBlock,
  }: Omit<routes.validator.ExtraProduceBlockOpts, "builderSelection"> & {
    commonBlockBodyPromise: Promise<CommonBlockBody>;
    parentBlock: ProtoBlock;
  }
): Promise<ProduceBlindedBlockRes> {
  const {config, metrics, logger} = this;
  const version = config.getForkName(slot);
  if (!isForkPostBellatrix(version)) {
    throw Error(`Invalid fork=${version} for produceBuilderBlindedBlock`);
  }

  const source = ProducedBlockSource.builder;
  metrics?.blockProductionRequests.inc({source});

  // Error early for builder if builder flow not active
  if (!this.executionBuilder) {
    throw Error("External builder not configured");
  }

  switch (this.executionBuilder.status) {
    case BuilderStatus.disabled:
      throw Error("External builder disabled due to failed status check");
    case BuilderStatus.circuitBreaker:
      throw Error("External builder circuit breaker is activated");
    case BuilderStatus.enabled:
      // continue
      break;
  }

  let timer: undefined | ((opts: {source: ProducedBlockSource}) => number);
  try {
    timer = metrics?.blockProductionTime.startTimer();
    const {block, executionPayloadValue, consensusBlockValue, produceResult} = await produceBlindedBlock.call(this, {
      slot,
      parentBlock,
      randaoReveal,
      graffiti,
      commonBlockBodyPromise,
    });

    metrics?.blockProductionSuccess.inc({source});
    metrics?.blockProductionNumAggregated.observe({source}, block.body.attestations.length);
    metrics?.blockProductionConsensusBlockValue.observe({source}, Number(formatWeiToEth(consensusBlockValue)));
    metrics?.blockProductionExecutionPayloadValue.observe({source}, Number(formatWeiToEth(executionPayloadValue)));
    logger.verbose("Produced blinded block", {
      slot,
      executionPayloadValue: prettyWeiToEth(executionPayloadValue),
      consensusBlockValue: prettyWeiToEth(consensusBlockValue),
      root: toRootHex(config.getPostBellatrixForkTypes(slot).BlindedBeaconBlock.hashTreeRoot(block)),
    });

    // [beacon-engine] deviation: produced-block persistence stays in the API.

    return {produceResult, data: block, version, executionPayloadValue, consensusBlockValue};
  } finally {
    if (timer) timer({source});
  }
}

/**
 * Runs inside BeaconEngine. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/api/impl/validator/index.ts#produceEngineBlockContents.
 * Synced through unstable@2593063a82.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function produceEngineBlockContents(
  this: BeaconEngine,
  slot: Slot,
  randaoReveal: BLSSignature,
  graffiti: Bytes32,
  {
    feeRecipient,
    strictFeeRecipientCheck,
    commonBlockBodyPromise,
    parentBlock,
  }: Omit<routes.validator.ExtraProduceBlockOpts, "builderSelection"> & {
    commonBlockBodyPromise: Promise<CommonBlockBody>;
    parentBlock: ProtoBlock;
  }
): Promise<ProduceBlockContentsRes & {shouldOverrideBuilder?: boolean}> {
  const {config, metrics, logger} = this;
  const version = config.getForkName(slot);
  if (isForkPostGloas(version)) {
    throw Error(`produceEngineBlockContents called for post-gloas fork=${version}`);
  }
  const source = ProducedBlockSource.engine;
  metrics?.blockProductionRequests.inc({source});

  let timer: undefined | ((opts: {source: ProducedBlockSource}) => number);
  try {
    timer = metrics?.blockProductionTime.startTimer();
    const {block, executionPayloadValue, consensusBlockValue, shouldOverrideBuilder, produceResult} =
      await produceSelfBlock.call(this, {
        slot,
        parentBlock,
        randaoReveal,
        graffiti,
        feeRecipient,
        commonBlockBodyPromise,
      });
    if (strictFeeRecipientCheck && feeRecipient && isForkPostBellatrix(version)) {
      const blockFeeRecipient = toHex((block as bellatrix.BeaconBlock).body.executionPayload.feeRecipient);
      if (blockFeeRecipient !== feeRecipient) {
        throw Error(`Invalid feeRecipient set in engine block expected=${feeRecipient} actual=${blockFeeRecipient}`);
      }
    }

    metrics?.blockProductionSuccess.inc({source});
    metrics?.blockProductionNumAggregated.observe({source}, block.body.attestations.length);
    metrics?.blockProductionConsensusBlockValue.observe({source}, Number(formatWeiToEth(consensusBlockValue)));
    metrics?.blockProductionExecutionPayloadValue.observe({source}, Number(formatWeiToEth(executionPayloadValue)));

    const blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block));
    logger.verbose("Produced execution block", {
      slot,
      executionPayloadValue: prettyWeiToEth(executionPayloadValue),
      consensusBlockValue: prettyWeiToEth(consensusBlockValue),
      root: blockRoot,
    });
    // [beacon-engine] deviation: produced-block persistence stays in the API.
    if (isForkPostDeneb(version)) {
      // [beacon-engine] deviation: use returned DA artifacts, not the facade cache.
      if (produceResult === undefined) {
        throw Error("production result missing in cache");
      }
      if (!isForkPostDeneb(produceResult.fork)) {
        throw Error("production result is for pre-deneb fork");
      }
      if (produceResult.type !== BlockType.Full) {
        throw Error("production result is not full block");
      }
      const blobsBundle = (produceResult as ProduceFullDeneb).blobsBundle;

      return {
        produceResult,
        data: {
          block: block as BeaconBlock<ForkPostDeneb & ForkPreGloas>,
          blobs: blobsBundle.blobs,
          kzgProofs: blobsBundle.proofs,
        },
        version,
        executionPayloadValue,
        consensusBlockValue,
        shouldOverrideBuilder,
      };
    }

    return {
      produceResult,
      data: {block: block as BeaconBlock<ForkPreDeneb>},
      version,
      executionPayloadValue,
      consensusBlockValue,
      shouldOverrideBuilder,
    };
  } finally {
    if (timer) timer({source});
  }
}

/**
 * Runs inside BeaconEngine. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/api/impl/validator/index.ts#produceEngineOrBuilderBlock.
 * Synced through unstable@2593063a82.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function produceEngineOrBuilderBlock(
  this: BeaconEngine,
  slot: Slot,
  randaoReveal: BLSSignature,
  graffiti: Bytes32,
  builderBoostFactor?: bigint,
  {feeRecipient, builderSelection, strictFeeRecipientCheck}: routes.validator.ExtraProduceBlockOpts = {}
): Promise<ProduceBlindedBlockOrBlockContentsRes> {
  const {config, metrics, logger} = this;
  builderSelection = builderSelection ?? routes.validator.BuilderSelection.MaxProfit;
  if (builderSelection === routes.validator.BuilderSelection.BuilderOnly) {
    logger.warn("Builder selection builderonly is no longer supported, treating as builderalways");
    builderSelection = routes.validator.BuilderSelection.BuilderAlways;
  }
  builderBoostFactor = builderBoostFactor ?? BigInt(100);
  if (builderBoostFactor > MAX_BUILDER_BOOST_FACTOR) {
    throw new ApiError(400, `Invalid builderBoostFactor=${builderBoostFactor} > MAX_BUILDER_BOOST_FACTOR`);
  } // Must never request for a future slot > currentSlot

  const parentBlock = this.getProposerHead(slot);
  const {blockRoot: parentBlockRootHex, slot: parentSlot} = parentBlock;
  // An optimistic validator MUST NOT produce a block
  if (isOptimisticBlock(parentBlock)) {
    throw new NodeIsSyncing(
      `Parent block's execution payload not yet validated, executionPayloadBlockHash=${parentBlock.executionPayloadBlockHash}`
    );
  }
  if (parentBlock.dataAvailabilityStatus === DataAvailabilityStatus.OutOfRange)
    throw new NodeIsSyncing("Block's data is out of range and not validated");
  metrics?.blockProductionSlotDelta.set(slot - parentSlot);

  const fork = config.getForkName(slot);

  const isBuilderEnabled =
    ForkSeq[fork] >= ForkSeq.bellatrix &&
    this.executionBuilder !== undefined &&
    builderSelection !== routes.validator.BuilderSelection.ExecutionOnly;

  const graffitiBytes = graffiti;

  const loggerContext = {
    slot,
    parentSlot,
    parentBlockRoot: parentBlockRootHex,
    fork,
    builderSelection,
    isBuilderEnabled,
    strictFeeRecipientCheck,
    builderBoostFactor,
  };

  logger.verbose("Assembling block with produceEngineOrBuilderBlock", loggerContext);

  // Defer common block body production to make sure we sent async builder and engine requests before
  const deferredCommonBlockBody = defer<CommonBlockBody>();
  const commonBlockBodyPromise = deferredCommonBlockBody.promise;

  // use abort controller to stop waiting for both block sources
  const controller = new AbortController();

  // Start calls for building execution and builder blocks
  const builderPromise = isBuilderEnabled
    ? produceBuilderBlindedBlock.call(this, slot, randaoReveal, graffitiBytes, {
        feeRecipient,
        // can't do fee recipient checks as builder bid doesn't return feeRecipient as of now
        strictFeeRecipientCheck: false,
        commonBlockBodyPromise,
        parentBlock,
      })
    : Promise.reject(new Error("Builder disabled"));

  const enginePromise = produceEngineBlockContents
    .call(this, slot, randaoReveal, graffitiBytes, {
      feeRecipient,
      strictFeeRecipientCheck,
      commonBlockBodyPromise,
      parentBlock,
    })
    .then((engineBlock) => {
      // Once the engine returns a block, in the event of either:
      // - suspected builder censorship
      // - builder boost factor set to 0 or builder selection `executionalways`
      // we don't need to wait for builder block as engine block will always be selected
      if (
        engineBlock.shouldOverrideBuilder ||
        builderBoostFactor === BigInt(0) ||
        builderSelection === routes.validator.BuilderSelection.ExecutionAlways
      ) {
        controller.abort();
      }
      return engineBlock;
    });

  // Calculate cutoff time based on start of the slot
  const cutoffMs = Math.max(
    0,
    config.getSlotComponentDurationMs(fork, BLOCK_PRODUCTION_RACE_CUTOFF_BPS) - this.clock.msFromSlot(slot)
  );

  logger.verbose("Block production race (builder vs execution) starting", {
    ...loggerContext,
    cutoffMs,
    timeoutMs: config.getSlotDurationMs(fork),
  });

  const blockProductionRacePromise = resolveOrRacePromises([builderPromise, enginePromise], {
    resolveTimeoutMs: cutoffMs,
    raceTimeoutMs: config.getSlotDurationMs(fork),
    signal: controller.signal,
  });

  // Ensure builder and engine HTTP requests are sent before starting common block body production
  // by deferring the call to next event loop iteration, allowing pending I/O operations like
  // HTTP requests to be processed first and sent out early in slot.
  callInNextEventLoop(() => {
    logger.verbose("Producing common block body", loggerContext);
    const commonBlockBodyStartedAt = Date.now();

    this.produceCommonBlockBody({
      slot,
      parentBlock,
      randaoReveal,
      graffiti: graffitiBytes,
    })
      .then((commonBlockBody) => {
        deferredCommonBlockBody.resolve(commonBlockBody);
        logger.verbose("Produced common block body", {
          ...loggerContext,
          durationMs: Date.now() - commonBlockBodyStartedAt,
        });
      })
      .catch(deferredCommonBlockBody.reject);
  });

  const [builder, engine] = await blockProductionRacePromise;

  if (builder.status === "pending" && engine.status === "pending") {
    throw Error("Builder and engine both failed to produce the block within timeout");
  }

  if (engine.status === "pending" && !isBuilderEnabled) {
    throw Error("Engine failed to produce the block within timeout");
  }

  if (engine.status === "rejected") {
    logger.warn(
      "Engine failed to produce the block",
      {
        ...loggerContext,
        durationMs: engine.durationMs,
      },
      engine.reason
    );
  } else if (engine.status === "pending") {
    logger.warn("Engine failed to produce the block within cutoff time", {
      ...loggerContext,
      cutoffMs,
    });
  }

  if (isBuilderEnabled) {
    if (builder.status === "rejected") {
      if (builder.reason instanceof NoBidReceived) {
        logger.info("Builder did not provide a bid", {
          ...loggerContext,
          durationMs: builder.durationMs,
        });
      } else {
        logger.warn(
          "Builder failed to produce the block",
          {
            ...loggerContext,
            durationMs: builder.durationMs,
          },
          builder.reason
        );
      }
    } else if (builder.status === "pending") {
      logger.warn("Builder failed to produce the block within cutoff time", {
        ...loggerContext,
        cutoffMs,
      });
    }
  }

  if (builder.status === "rejected" && engine.status === "rejected") {
    throw Error(`${isBuilderEnabled ? "Builder and engine both" : "Engine"} failed to produce the block`);
  }

  // handle shouldOverrideBuilder separately
  if (engine.status === "fulfilled" && engine.value.shouldOverrideBuilder && isBuilderEnabled) {
    logger.warn("Selected engine block: censorship suspected in builder blocks", {
      ...loggerContext,
      durationMs: engine.durationMs,
      shouldOverrideBuilder: engine.value.shouldOverrideBuilder,
      ...getBlockValueLogInfo(engine.value),
    });

    metrics?.blockProductionSelectionResults.inc({
      source: ProducedBlockSource.engine,
      reason: EngineBlockSelectionReason.BuilderCensorship,
    });

    return {...engine.value, executionPayloadBlinded: false, executionPayloadSource: ProducedBlockSource.engine};
  }

  if (builder.status === "fulfilled" && engine.status !== "fulfilled") {
    const reason =
      engine.status === "pending" ? BuilderBlockSelectionReason.EnginePending : BuilderBlockSelectionReason.EngineError;

    logger.info("Selected builder block: no engine block produced", {
      reason,
      ...loggerContext,
      durationMs: builder.durationMs,
      ...getBlockValueLogInfo(builder.value),
    });

    metrics?.blockProductionSelectionResults.inc({
      source: ProducedBlockSource.builder,
      reason,
    });

    return {...builder.value, executionPayloadBlinded: true, executionPayloadSource: ProducedBlockSource.builder};
  }

  if (engine.status === "fulfilled" && builder.status !== "fulfilled") {
    const reason =
      isBuilderEnabled === false
        ? EngineBlockSelectionReason.BuilderDisabled
        : builder.status === "pending"
          ? EngineBlockSelectionReason.BuilderPending
          : builder.reason instanceof NoBidReceived
            ? EngineBlockSelectionReason.BuilderNoBid
            : builder.reason instanceof TimeoutError
              ? EngineBlockSelectionReason.BuilderTimeout
              : EngineBlockSelectionReason.BuilderError;

    logger.info("Selected engine block: no builder block produced", {
      reason,
      ...loggerContext,
      durationMs: engine.durationMs,
      ...getBlockValueLogInfo(engine.value),
    });

    metrics?.blockProductionSelectionResults.inc({
      source: ProducedBlockSource.engine,
      reason,
    });

    return {...engine.value, executionPayloadBlinded: false, executionPayloadSource: ProducedBlockSource.engine};
  }

  if (engine.status === "fulfilled" && builder.status === "fulfilled") {
    const result = selectBlockProductionSource({
      builderExecutionPayloadValue: builder.value.executionPayloadValue,
      engineExecutionPayloadValue: engine.value.executionPayloadValue,
      builderBoostFactor,
      builderSelection,
    });
    const executionPayloadSource = result.source;

    metrics?.blockProductionSelectionResults.inc(result);

    logger.info(`Selected ${executionPayloadSource} block`, {
      reason: result.reason,
      ...loggerContext,
      engineDurationMs: engine.durationMs,
      ...getBlockValueLogInfo(engine.value, ProducedBlockSource.engine),
      builderDurationMs: builder.durationMs,
      ...getBlockValueLogInfo(builder.value, ProducedBlockSource.builder),
    });

    if (executionPayloadSource === ProducedBlockSource.engine) {
      return {
        ...engine.value,
        executionPayloadBlinded: false,
        executionPayloadSource,
      };
    }

    return {
      ...builder.value,
      executionPayloadBlinded: true,
      executionPayloadSource,
    };
  }

  throw Error("Unreachable error occurred during the builder and execution block production");
}
/**
 * Runs inside BeaconEngine. Moved from unstable@ba0411b482 packages/beacon-node/src/api/impl/validator/index.ts#produceBlockV4.
 * Synced through unstable@2593063a82.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function produceBlockV4(
  this: BeaconEngine,
  {
    slot,
    randaoReveal,
    graffiti,
    feeRecipient,
    strictFeeRecipientCheck,
    includePayload,
    builderConfig,
  }: ProduceBlockV4Request
): Promise<ProduceBlockV4Result> {
  const {config, metrics, logger} = this;
  const fork = config.getForkName(slot);

  if (!isForkPostGloas(fork)) {
    throw new ApiError(400, `produceBlockV4 not supported for pre-gloas fork=${fork}`);
  }

  const builderBoostFactor = builderConfig.builderBoostFactor;
  if (builderBoostFactor > MAX_BUILDER_BOOST_FACTOR) {
    throw new ApiError(400, `Invalid builderBoostFactor=${builderBoostFactor} > MAX_BUILDER_BOOST_FACTOR`);
  }

  const parentBlock = this.getProposerHead(slot);
  const {blockRoot: parentBlockRootHex, slot: parentSlot} = parentBlock;
  const parentBlockRoot = fromHex(parentBlockRootHex);
  // An optimistic validator MUST NOT produce a block
  if (isOptimisticBlock(parentBlock)) {
    throw new NodeIsSyncing(
      `Parent block's execution payload not yet validated, executionPayloadBlockHash=${parentBlock.executionPayloadBlockHash}`
    );
  }
  if (parentBlock.dataAvailabilityStatus === DataAvailabilityStatus.OutOfRange)
    throw new NodeIsSyncing("Block's data is out of range and not validated");
  metrics?.blockProductionSlotDelta.set(slot - parentSlot);

  const graffitiBytes = graffiti;

  const isBuildingOnFull = this.forkChoice.shouldBuildOnFull(parentBlock, slot);
  const bidParentBlockHash = isBuildingOnFull ? parentBlock.executionPayloadBlockHash : parentBlock.parentBlockHash;
  // Post-gloas every proposal parent has an execution payload hash
  if (bidParentBlockHash === null) {
    throw new ApiError(500, `Unknown parent block hash for proposal parent ${parentBlockRootHex}`);
  }
  const circuitBreakerActive = this.builderCircuitBreaker.isActive(slot, parentBlock);

  // Fire builder API bid requests while the local payload is built, one request per entry.
  // Any entry failure yields no bid and never fails block production.
  let builderApiBidsPromise: Promise<BuilderApiBid[]> = Promise.resolve([]);
  if (builderConfig.builders.length > 0 && !circuitBreakerActive) {
    try {
      const proposerIndex = this.getHeadState().getBeaconProposer(slot);
      const proposerPubkey = this.pubkeyCache.getPubkeyBytesOrThrow(proposerIndex);
      builderApiBidsPromise = this.builderApiClient.getExecutionPayloadBids(
        builderConfig.builders,
        slot,
        fromHex(bidParentBlockHash),
        parentBlockRoot,
        proposerPubkey
      );
    } catch (e) {
      logger.warn("Unable to request builder API bids", {slot}, e as Error);
    }
  }

  // A builder bid is expected if builders are configured or a p2p bid was already received.
  // Used by the censorship override which may run before the bid deadline
  const builderBidExpected =
    builderConfig.builders.length > 0 ||
    (!circuitBreakerActive &&
      this.executionPayloadBidPool.getBestBid(slot, bidParentBlockHash, parentBlockRootHex) !== null);

  // Select the p2p bid once builders had time to bid up, matching the deadline advertised
  // on builder API bid requests, unless the circuit breaker is active
  const p2pBidPromise: Promise<PooledExecutionPayloadBid | null> = circuitBreakerActive
    ? Promise.resolve(null)
    : sleep(Math.max(0, BUILDER_BID_DEADLINE_MS - this.clock.msFromSlot(slot))).then(() => {
        const p2pBid = this.executionPayloadBidPool.getBestBid(slot, bidParentBlockHash, parentBlockRootHex);
        // Discard p2p bids below the proposer's configured floor on the total payment.
        // A p2p bid's total is just its value since gossip validation enforces executionPayment=0.
        if (p2pBid !== null && BigInt(p2pBid.signedBid.message.value) < builderConfig.minBid) {
          logger.info("Best p2p bid below configured minimum", {
            slot,
            bidValue: prettyGweiToEth(p2pBid.signedBid.message.value),
            minBid: prettyGweiToEth(builderConfig.minBid),
          });
          return null;
        }
        return p2pBid;
      });

  // Candidates are ranked by their boosted counted total payment, the p2p bid is governed
  // by the top-level factors and each builder API bid by its own entry. Ties prefer the
  // earliest received builder API bid, so the signed block can be routed back to its
  // builder directly.
  const bestBidPromise: Promise<BidCandidate | null> = (async () => {
    const [builderApiBids, p2pBid] = await Promise.all([builderApiBidsPromise, p2pBidPromise]);
    let parentExecutionRequestsPromise: Promise<gloas.ExecutionRequests> | null = null;

    const candidates = (
      await Promise.all(
        builderApiBids.map(async ({url, entry, signedBid, receivedMs}): Promise<BidCandidate | null> => {
          try {
            await validateBuilderApiExecutionPayloadBid(this, signedBid, {
              slot,
              parentBlock,
              parentBlockHash: bidParentBlockHash,
              parentBlockRoot: parentBlockRootHex,
              entry,
              getParentExecutionRequests: () => {
                parentExecutionRequestsPromise ??= this.getParentExecutionRequests(parentSlot, parentBlockRootHex);
                return parentExecutionRequestsPromise;
              },
            });
            return {
              signedBid,
              totalGwei: getBuilderBidTotalGwei(signedBid.message, entry.maxExecutionPayment),
              boostFactor: entry.builderBoostFactor,
              url,
              receivedMs,
            };
          } catch (e) {
            metrics?.builderApi.bidsDiscarded.inc();
            logger.warn("Ignoring invalid builder API bid", {slot, builder: toPrintableUrl(url)}, e as Error);
            return null;
          }
        })
      )
    ).filter((candidate): candidate is BidCandidate => candidate !== null);

    if (p2pBid !== null) {
      candidates.push({
        signedBid: p2pBid.signedBid,
        totalGwei: BigInt(p2pBid.signedBid.message.value),
        boostFactor: builderConfig.builderBoostFactor,
        receivedMs: p2pBid.receivedMs,
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    const rankedCandidates = candidates.toSorted(compareBidCandidates);
    for (const [index, candidate] of rankedCandidates.entries()) {
      logger.debug("Builder bid candidate", {
        slot,
        rank: index + 1,
        source: candidate.url !== undefined ? toPrintableUrl(candidate.url) : "p2p",
        builder: candidate.signedBid.message.builderIndex,
        value: prettyGweiToEth(candidate.signedBid.message.value),
        executionPayment: prettyGweiToEth(candidate.signedBid.message.executionPayment),
        total: prettyGweiToEth(candidate.totalGwei),
        boost: candidate.boostFactor,
        boosted: prettyGweiToEth(getBoostedTotalScaled(candidate) / 100n),
        receivedMs: candidate.receivedMs,
      });
    }
    return rankedCandidates[0];
  })();

  const commonBlockBodyPromise = this.produceCommonBlockBody({
    slot,
    parentBlock,
    randaoReveal,
    graffiti: graffitiBytes,
  });

  const baseAttrs = {
    slot,
    parentBlock,
    randaoReveal,
    graffiti: graffitiBytes,
    feeRecipient,
    strictFeeRecipientCheck,
    commonBlockBodyPromise,
  };

  metrics?.blockProductionRequests.inc({source: ProducedBlockSource.engine});

  const timed = <T>(source: ProducedBlockSource, fn: () => Promise<T>): Promise<T> => {
    const t = metrics?.blockProductionTime.startTimer();
    return fn().finally(() => t?.({source}));
  };

  // Calculate cutoff time based on start of the slot, ensures a slow local payload build does
  // not delay the proposal when a builder bid block is available (and vice versa)
  const cutoffMs = Math.max(
    0,
    config.getSlotComponentDurationMs(fork, BLOCK_PRODUCTION_RACE_CUTOFF_BPS) - this.clock.msFromSlot(slot)
  );

  // use abort controller to stop waiting for the bid block if the engine block will be selected
  const controller = new AbortController();

  const enginePromise: ReturnType<typeof produceSelfBlock> = timed(ProducedBlockSource.engine, () =>
    produceSelfBlock.call(this, baseAttrs)
  ).then((engineBlock) => {
    // No need to wait for the bid block if the engine block will always be selected, either
    // due to suspected builder censorship, or because no builders are configured and the
    // boost factor of 0 always prefers the local block over p2p bids
    if (engineBlock.shouldOverrideBuilder || (builderConfig.builders.length === 0 && builderBoostFactor === 0n)) {
      controller.abort();
    }
    return engineBlock;
  });
  const bidBlockPromise: ReturnType<typeof produceSelfBlock> = bestBidPromise.then((candidate) => {
    if (candidate === null) {
      throw new Error(NO_BID_AVAILABLE);
    }
    metrics?.blockProductionRequests.inc({source: ProducedBlockSource.builder});
    return timed(ProducedBlockSource.builder, () =>
      produceSelfBlock.call(this, {...baseAttrs, builderBid: candidate.signedBid})
    );
  });

  const [engineResult, bidBlockResult] = await resolveOrRacePromises([enginePromise, bidBlockPromise], {
    resolveTimeoutMs: cutoffMs,
    raceTimeoutMs: config.getSlotDurationMs(fork),
    signal: controller.signal,
  });

  let bestResult: typeof engineResult | null = null;
  let source: ProducedBlockSource = ProducedBlockSource.engine;

  // Resolved instantly whenever the bid branch produced a block
  const bestBid = bidBlockResult.status === "fulfilled" ? await bestBidPromise : null;

  const logCtx = {
    slot,
    parentSlot,
    parentBlockRoot: parentBlockRootHex,
    parentBlockHash: parentBlock.executionPayloadBlockHash,
    fork,
    builderBoostFactor,
    strictFeeRecipientCheck,
    circuitBreakerActive,
    builderEntries: builderConfig.builders.length,
    ...(bestBid !== null
      ? {
          bidSource: bestBid.url !== undefined ? toPrintableUrl(bestBid.url) : "p2p",
          bidValue: prettyGweiToEth(bestBid.signedBid.message.value),
          bidExecutionPayment: prettyGweiToEth(bestBid.signedBid.message.executionPayment),
          // The full bid total and the counted total used during bid selection
          bidTotal: prettyGweiToEth(
            BigInt(bestBid.signedBid.message.value) + bestBid.signedBid.message.executionPayment
          ),
          bidCountedTotal: prettyGweiToEth(bestBid.totalGwei),
          bidBoostFactor: bestBid.boostFactor,
          builderIndex: bestBid.signedBid.message.builderIndex,
          bidBlockHash: toRootHex(bestBid.signedBid.message.blockHash),
          bidReceivedMs: bestBid.receivedMs,
        }
      : {}),
  };

  if (circuitBreakerActive && engineResult.status === "fulfilled") {
    source = ProducedBlockSource.engine;
    bestResult = engineResult;
    metrics?.blockProductionSelectionResults.inc({
      source: ProducedBlockSource.engine,
      reason: EngineBlockSelectionReason.BuilderCircuitBreaker,
    });
    logger.info("Selected local block: builder circuit breaker is active", {
      reason: EngineBlockSelectionReason.BuilderCircuitBreaker,
      ...logCtx,
      durationMs: engineResult.durationMs,
      ...getBlockValueLogInfo(engineResult.value),
    });
  } else if (
    // handle shouldOverrideBuilder separately
    engineResult.status === "fulfilled" &&
    engineResult.value.shouldOverrideBuilder &&
    (builderBidExpected || bidBlockResult.status === "fulfilled")
  ) {
    source = ProducedBlockSource.engine;
    bestResult = engineResult;
    metrics?.blockProductionSelectionResults.inc({
      source: ProducedBlockSource.engine,
      reason: EngineBlockSelectionReason.BuilderCensorship,
    });
    logger.warn("Selected local block: censorship suspected in builder bid", {
      ...logCtx,
      durationMs: engineResult.durationMs,
      ...getBlockValueLogInfo(engineResult.value),
    });
  } else if (engineResult.status === "fulfilled" && bidBlockResult.status === "fulfilled") {
    const result = selectBlockProductionSourceByBoostFactor({
      builderBoostFactor: bestBid?.boostFactor ?? builderBoostFactor,
      engineExecutionPayloadValue: engineResult.value.executionPayloadValue,
      // The bid total payment is its value plus its counted executionPayment, in Gwei
      builderExecutionPayloadValue: (bestBid?.totalGwei ?? 0n) * GWEI_TO_WEI,
    });
    source = result.source;
    metrics?.blockProductionSelectionResults.inc(result);
    logger.info(`Selected ${source} block`, {
      reason: result.reason,
      ...logCtx,
      engineDurationMs: engineResult.durationMs,
      ...getBlockValueLogInfo(engineResult.value, ProducedBlockSource.engine),
      builderDurationMs: bidBlockResult.durationMs,
    });
    bestResult = source === ProducedBlockSource.builder ? bidBlockResult : engineResult;
  } else if (bidBlockResult.status === "fulfilled") {
    source = ProducedBlockSource.builder;
    bestResult = bidBlockResult;
    const reason =
      engineResult.status === "pending"
        ? BuilderBlockSelectionReason.EnginePending
        : BuilderBlockSelectionReason.EngineError;
    metrics?.blockProductionSelectionResults.inc({source: ProducedBlockSource.builder, reason});
    logger.info("Selected builder bid block: no local block produced", {
      reason,
      ...logCtx,
      durationMs: bidBlockResult.durationMs,
      ...getBlockValueLogInfo(bidBlockResult.value),
      error: engineResult.status === "rejected" ? (engineResult.reason as Error).message : undefined,
    });
  } else if (engineResult.status === "fulfilled") {
    source = ProducedBlockSource.engine;
    bestResult = engineResult;
    const reason =
      bidBlockResult.status === "rejected" && (bidBlockResult.reason as Error).message === NO_BID_AVAILABLE
        ? EngineBlockSelectionReason.BuilderNoBid
        : bidBlockResult.status === "pending"
          ? EngineBlockSelectionReason.BuilderPending
          : EngineBlockSelectionReason.BuilderError;
    metrics?.blockProductionSelectionResults.inc({source: ProducedBlockSource.engine, reason});
    logger.info("Selected local block: no builder bid block produced", {
      reason,
      ...logCtx,
      durationMs: engineResult.durationMs,
      ...getBlockValueLogInfo(engineResult.value),
      error: bidBlockResult.status === "rejected" ? (bidBlockResult.reason as Error).message : undefined,
    });
  }

  if (bestResult === null || bestResult.status !== "fulfilled") {
    const engineReason = engineResult.status === "rejected" ? engineResult.reason : engineResult.status;
    const bidReason = bidBlockResult.status === "rejected" ? bidBlockResult.reason : bidBlockResult.status;
    logger.error("Block production failed", {
      ...logCtx,
      engineReason: String(engineReason),
      bidReason: String(bidReason),
    });
    throw Error(`Block production failed: engine=${String(engineReason)} builder=${String(bidReason)}`);
  }

  const {block, executionPayloadValue, consensusBlockValue, produceResult} = bestResult.value;

  metrics?.blockProductionSuccess.inc({source});
  metrics?.blockProductionNumAggregated.observe({source}, block.body.attestations.length);
  metrics?.blockProductionConsensusBlockValue.observe({source}, Number(formatWeiToEth(consensusBlockValue)));
  metrics?.blockProductionExecutionPayloadValue.observe({source}, Number(formatWeiToEth(executionPayloadValue)));

  const blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block));
  logger.verbose("Produced block", {
    ...logCtx,
    executionPayloadValue: prettyWeiToEth(executionPayloadValue),
    consensusBlockValue: prettyWeiToEth(consensusBlockValue),
    root: blockRoot,
  });
  // [beacon-engine] deviation: produced-block persistence stays in the API.

  // Include the payload for self-builds unless disabled (stateless flow)
  const isSelfBuild = source === ProducedBlockSource.engine;
  if (isSelfBuild && includePayload) {
    // [beacon-engine] deviation: use returned DA artifacts, not the facade cache.
    if (produceResult === undefined || !isForkPostGloas(produceResult.fork) || produceResult.type !== BlockType.Full) {
      throw Error(`Missing cached block production result for produced block slot=${slot} blockRoot=${blockRoot}`);
    }
    const {executionPayload, executionRequests, blobsBundle, parentBlockRoot} = produceResult as ProduceFullGloas;

    const blockContents: gloas.BlockContents = {
      block: block as gloas.BeaconBlock,
      executionPayloadEnvelope: {
        payload: executionPayload,
        executionRequests,
        builderIndex: BUILDER_INDEX_SELF_BUILD,
        beaconBlockRoot: fromHex(blockRoot),
        parentBeaconBlockRoot: parentBlockRoot,
      },
      kzgProofs: blobsBundle.proofs,
      blobs: blobsBundle.blobs,
    };

    return {
      produceResult,
      executionPayloadSource: source,
      data: blockContents,
      meta: {version: fork, consensusBlockValue, executionPayloadValue, executionPayloadIncluded: true},
    };
  }

  return {
    produceResult,
    executionPayloadSource: source,
    data: block as gloas.BeaconBlock,
    meta: {
      version: fork,
      consensusBlockValue,
      executionPayloadValue,
      executionPayloadIncluded: false,
      builderUrl: source === ProducedBlockSource.builder ? bestBid?.url : undefined,
    },
  };
}

const NO_BID_AVAILABLE = "No builder bid available";
type BidCandidate = {
  signedBid: gloas.SignedExecutionPayloadBid;
  /** Total payment in Gwei, counting the execution payment at most at the entry's cap */
  totalGwei: bigint;
  boostFactor: bigint;
  url?: string;
  /** Time in milliseconds from the slot start when the bid was received */
  receivedMs: number;
};
function getBoostedTotalScaled({totalGwei, boostFactor}: BidCandidate): bigint {
  return boostFactor * totalGwei;
}
function compareBidCandidates(a: BidCandidate, b: BidCandidate): number {
  // Preserve max boost preference before comparing bid values
  const aIsMaxBoost = a.boostFactor === MAX_BUILDER_BOOST_FACTOR;
  const bIsMaxBoost = b.boostFactor === MAX_BUILDER_BOOST_FACTOR;
  if (aIsMaxBoost !== bIsMaxBoost) {
    return aIsMaxBoost ? -1 : 1;
  }

  const aBoostedTotal = getBoostedTotalScaled(a);
  const bBoostedTotal = getBoostedTotalScaled(b);
  if (aBoostedTotal !== bBoostedTotal) {
    return aBoostedTotal > bBoostedTotal ? -1 : 1;
  }

  // A tie prefers a builder api bid over the p2p bid
  const aIsBuilderApi = a.url !== undefined;
  const bIsBuilderApi = b.url !== undefined;
  if (aIsBuilderApi !== bIsBuilderApi) {
    return aIsBuilderApi ? -1 : 1;
  }

  // and the earlier received bid between builder api bids
  return a.receivedMs - b.receivedMs;
}
