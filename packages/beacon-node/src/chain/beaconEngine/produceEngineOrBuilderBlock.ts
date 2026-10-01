import {routes} from "@lodestar/api";
import {ProtoBlock} from "@lodestar/fork-choice";
import {
  ForkName,
  ForkPostBellatrix,
  ForkSeq,
  isForkPostBellatrix,
  isForkPostDeneb,
  isForkPostGloas,
} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {
  BLSSignature,
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
  TimeoutError,
  defer,
  formatWeiToEth,
  prettyWeiToEth,
  resolveOrRacePromises,
  toHex,
  toRootHex,
} from "@lodestar/utils";
import {ApiError, NodeIsSyncing} from "../../api/impl/errors.js";
import {selectBlockProductionSource} from "../../api/impl/validator/utils.js";
import {BuilderStatus, NoBidReceived} from "../../execution/builder/http.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {CommonBlockBody} from "../interface.js";
import {BlockType, ProduceFullDeneb, ProduceResult} from "../produceBlock/index.js";
import type {BeaconEngine} from "./beaconEngine.js";
import type {ProduceBlockV4Request, ProduceBlockV4Result} from "./interface.js";
import {produceBlindedBlock, produceBlock as produceSelfBlock} from "./produceBlock.js";

/**
 * Cutoff time to wait from start of the slot for execution and builder block production apis to resolve.
 * Post this time, race execution and builder to pick whatever resolves first.
 *
 * Empirically the builder block resolves in ~1 second, and execution block resolves in <500 ms.
 * A cutoff of 2 seconds gives enough time and if there are unexpected delays it ensures we publish
 * in time as proposals post 4 seconds into the slot will likely be orphaned due to proposer boost reorg.
 *
 * TODO GLOAS: re-evaluate cutoff timing
 */
const BLOCK_PRODUCTION_RACE_CUTOFF_MS = 2_000;
/** Overall timeout for execution and block production apis */
const BLOCK_PRODUCTION_RACE_TIMEOUT_MS = 12_000;

// [beacon-engine] deviation: selected results include DA artifacts for the facade cache.
type ProduceBlockContentsRes = {executionPayloadValue: Wei; consensusBlockValue: Wei} & {
  data: BlockContents;
  produceResult: ProduceResult;
  version: ForkName;
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
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/api/impl/validator/index.ts#getBlockValueLogInfo.
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
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/api/impl/validator/index.ts#produceBuilderBlindedBlock.
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
  const version = this.config.getForkName(slot);
  if (!isForkPostBellatrix(version)) {
    throw Error(`Invalid fork=${version} for produceBuilderBlindedBlock`);
  }

  const source = ProducedBlockSource.builder;
  this.metrics?.blockProductionRequests.inc({source});

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
    timer = this.metrics?.blockProductionTime.startTimer();
    const {block, executionPayloadValue, consensusBlockValue, produceResult} = await produceBlindedBlock.call(this, {
      slot,
      parentBlock,
      randaoReveal,
      graffiti,
      commonBlockBodyPromise,
    });

    this.metrics?.blockProductionSuccess.inc({source});
    this.metrics?.blockProductionNumAggregated.observe({source}, block.body.attestations.length);
    this.metrics?.blockProductionConsensusBlockValue.observe({source}, Number(formatWeiToEth(consensusBlockValue)));
    this.metrics?.blockProductionExecutionPayloadValue.observe({source}, Number(formatWeiToEth(executionPayloadValue)));
    this.logger.verbose("Produced blinded block", {
      slot,
      executionPayloadValue,
      consensusBlockValue,
      root: toRootHex(this.config.getPostBellatrixForkTypes(slot).BlindedBeaconBlock.hashTreeRoot(block)),
    });

    // [beacon-engine] deviation: the API persists the selected produced block for debugging.

    // [beacon-engine] deviation: return the builder artifacts to the facade with the selected block.
    return {data: block, version, executionPayloadValue, consensusBlockValue, produceResult};
  } finally {
    if (timer) timer({source});
  }
}

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/api/impl/validator/index.ts#produceEngineBlockContents.
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
  const source = ProducedBlockSource.engine;
  this.metrics?.blockProductionRequests.inc({source});

  let timer: undefined | ((opts: {source: ProducedBlockSource}) => number);
  try {
    timer = this.metrics?.blockProductionTime.startTimer();
    const {block, executionPayloadValue, consensusBlockValue, shouldOverrideBuilder, produceResult} =
      await produceSelfBlock.call(this, {
        slot,
        parentBlock,
        randaoReveal,
        graffiti,
        feeRecipient,
        commonBlockBodyPromise,
      });
    const version = this.config.getForkName(block.slot);
    if (strictFeeRecipientCheck && feeRecipient && isForkPostBellatrix(version)) {
      const blockFeeRecipient = toHex((block as bellatrix.BeaconBlock).body.executionPayload.feeRecipient);
      if (blockFeeRecipient !== feeRecipient) {
        throw Error(`Invalid feeRecipient set in engine block expected=${feeRecipient} actual=${blockFeeRecipient}`);
      }
    }

    this.metrics?.blockProductionSuccess.inc({source});
    this.metrics?.blockProductionNumAggregated.observe({source}, block.body.attestations.length);
    this.metrics?.blockProductionConsensusBlockValue.observe({source}, Number(formatWeiToEth(consensusBlockValue)));
    this.metrics?.blockProductionExecutionPayloadValue.observe({source}, Number(formatWeiToEth(executionPayloadValue)));

    const blockRoot = toRootHex(this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block));
    this.logger.verbose("Produced execution block", {
      slot,
      executionPayloadValue,
      consensusBlockValue,
      root: blockRoot,
    });
    // [beacon-engine] deviation: the API persists the selected produced block for debugging.
    if (isForkPostDeneb(version)) {
      // [beacon-engine] deviation: DA artifacts come from self-build, without the facade cache.
      if (!isForkPostDeneb(produceResult.fork)) {
        throw Error("production result is for pre-deneb fork");
      }
      if (produceResult.type !== BlockType.Full) {
        throw Error("production result is not full block");
      }
      const blobsBundle = (produceResult as ProduceFullDeneb).blobsBundle;

      return {
        data: {
          block,
          blobs: blobsBundle.blobs,
          kzgProofs: blobsBundle.proofs,
        },
        version,
        executionPayloadValue,
        consensusBlockValue,
        shouldOverrideBuilder,
        // [beacon-engine] deviation: return the self-build artifacts to the facade.
        produceResult,
      };
    }

    return {data: {block}, version, executionPayloadValue, consensusBlockValue, shouldOverrideBuilder, produceResult};
  } finally {
    if (timer) timer({source});
  }
}

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/api/impl/validator/index.ts#produceEngineOrBuilderBlock.
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
  // [beacon-engine] deviation: syncing, slot waiting, graffiti defaults and boost validation stay in the API.

  const parentBlock = this.getProposerHead(slot);
  const {blockRoot: parentBlockRootHex, slot: parentSlot} = parentBlock;
  // [beacon-engine] deviation: inspect the selected parent directly, without another fork-choice lookup.
  if (parentBlock.dataAvailabilityStatus === DataAvailabilityStatus.OutOfRange) {
    throw new NodeIsSyncing("Block's data is out of range and not validated");
  }
  this.metrics?.blockProductionSlotDelta.set(slot - parentSlot);

  const fork = this.config.getForkName(slot);
  // set some sensible opts
  // builderSelection will be deprecated and will run in mode MaxProfit if builder is enabled
  // and the actual selection will be determined using builderBoostFactor passed by the validator
  builderSelection = builderSelection ?? routes.validator.BuilderSelection.MaxProfit;
  builderBoostFactor = builderBoostFactor ?? BigInt(100);

  const isBuilderEnabled =
    ForkSeq[fork] >= ForkSeq.bellatrix &&
    this.executionBuilder !== undefined &&
    builderSelection !== routes.validator.BuilderSelection.ExecutionOnly;

  // At any point either the builder or execution or both flows should be active.
  //
  // Ideally such a scenario should be prevented on startup, but proposerSettingsFile or keymanager
  // configurations could cause a validator pubkey to have builder disabled with builder selection builder only
  // (TODO: independently make sure such an options update is not successful for a validator pubkey)
  //
  // So if builder is disabled ignore builder selection of builder only if caused by user mistake
  // https://github.com/ChainSafe/lodestar/issues/6338
  const isEngineEnabled = !isBuilderEnabled || builderSelection !== routes.validator.BuilderSelection.BuilderOnly;

  if (!isEngineEnabled && !isBuilderEnabled) {
    throw Error(
      `Internal Error: Neither builder nor execution proposal flow activated isBuilderEnabled=${isBuilderEnabled} builderSelection=${builderSelection}`
    );
  }

  // [beacon-engine] deviation: the API supplies graffiti as bytes, including its default.
  const graffitiBytes = graffiti;

  const loggerContext = {
    slot,
    parentSlot,
    parentBlockRoot: parentBlockRootHex,
    fork,
    builderSelection,
    isBuilderEnabled,
    isEngineEnabled,
    strictFeeRecipientCheck,
    // winston this.logger doesn't like bigint
    builderBoostFactor: `${builderBoostFactor}`,
  };

  this.logger.verbose("Assembling block with produceEngineOrBuilderBlock", loggerContext);

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

  const enginePromise = isEngineEnabled
    ? produceEngineBlockContents
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
        })
    : Promise.reject(new Error("Engine disabled"));

  // Calculate cutoff time based on start of the slot
  const cutoffMs = Math.max(0, BLOCK_PRODUCTION_RACE_CUTOFF_MS - this.clock.msFromSlot(slot));

  this.logger.verbose("Block production race (builder vs execution) starting", {
    ...loggerContext,
    cutoffMs,
    timeoutMs: BLOCK_PRODUCTION_RACE_TIMEOUT_MS,
  });

  const blockProductionRacePromise = resolveOrRacePromises([builderPromise, enginePromise], {
    resolveTimeoutMs: cutoffMs,
    raceTimeoutMs: BLOCK_PRODUCTION_RACE_TIMEOUT_MS,
    signal: controller.signal,
  });

  // Ensure builder and engine HTTP requests are sent before starting common block body production
  // by deferring the call to next event loop iteration, allowing pending I/O operations like
  // HTTP requests to be processed first and sent out early in slot.
  callInNextEventLoop(() => {
    this.logger.verbose("Producing common block body", loggerContext);
    const commonBlockBodyStartedAt = Date.now();

    this.produceCommonBlockBody({
      slot,
      parentBlock,
      randaoReveal,
      graffiti: graffitiBytes,
    })
      .then((commonBlockBody) => {
        deferredCommonBlockBody.resolve(commonBlockBody);
        this.logger.verbose("Produced common block body", {
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

  if (builder.status === "pending" && !isEngineEnabled) {
    throw Error("Builder failed to produce the block within timeout");
  }

  if (engine.status === "pending" && !isBuilderEnabled) {
    throw Error("Engine failed to produce the block within timeout");
  }

  if (isEngineEnabled) {
    if (engine.status === "rejected") {
      this.logger.warn(
        "Engine failed to produce the block",
        {
          ...loggerContext,
          durationMs: engine.durationMs,
        },
        engine.reason
      );
    } else if (engine.status === "pending") {
      this.logger.warn("Engine failed to produce the block within cutoff time", {
        ...loggerContext,
        cutoffMs,
      });
    }
  }

  if (isBuilderEnabled) {
    if (builder.status === "rejected") {
      if (builder.reason instanceof NoBidReceived) {
        this.logger.info("Builder did not provide a bid", {
          ...loggerContext,
          durationMs: builder.durationMs,
        });
      } else {
        this.logger.warn(
          "Builder failed to produce the block",
          {
            ...loggerContext,
            durationMs: builder.durationMs,
          },
          builder.reason
        );
      }
    } else if (builder.status === "pending") {
      this.logger.warn("Builder failed to produce the block within cutoff time", {
        ...loggerContext,
        cutoffMs,
      });
    }
  }

  if (builder.status === "rejected" && engine.status === "rejected") {
    throw Error(
      `${isBuilderEnabled && isEngineEnabled ? "Builder and engine both" : isBuilderEnabled ? "Builder" : "Engine"} failed to produce the block`
    );
  }

  // handle shouldOverrideBuilder separately
  if (engine.status === "fulfilled" && engine.value.shouldOverrideBuilder) {
    this.logger.info("Selected engine block: censorship suspected in builder blocks", {
      ...loggerContext,
      durationMs: engine.durationMs,
      shouldOverrideBuilder: engine.value.shouldOverrideBuilder,
      ...getBlockValueLogInfo(engine.value),
    });

    this.metrics?.blockProductionSelectionResults.inc({
      source: ProducedBlockSource.engine,
      reason: EngineBlockSelectionReason.BuilderCensorship,
    });

    return {...engine.value, executionPayloadBlinded: false, executionPayloadSource: ProducedBlockSource.engine};
  }

  if (builder.status === "fulfilled" && engine.status !== "fulfilled") {
    const reason =
      isEngineEnabled === false
        ? BuilderBlockSelectionReason.EngineDisabled
        : engine.status === "pending"
          ? BuilderBlockSelectionReason.EnginePending
          : BuilderBlockSelectionReason.EngineError;

    this.logger.info("Selected builder block: no engine block produced", {
      reason,
      ...loggerContext,
      durationMs: builder.durationMs,
      ...getBlockValueLogInfo(builder.value),
    });

    this.metrics?.blockProductionSelectionResults.inc({
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

    this.logger.info("Selected engine block: no builder block produced", {
      reason,
      ...loggerContext,
      durationMs: engine.durationMs,
      ...getBlockValueLogInfo(engine.value),
    });

    this.metrics?.blockProductionSelectionResults.inc({
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

    this.metrics?.blockProductionSelectionResults.inc(result);

    this.logger.info(`Selected ${executionPayloadSource} block`, {
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
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/api/impl/validator/index.ts#produceBlockV4.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function produceBlockV4(
  this: BeaconEngine,
  {slot, randaoReveal, graffiti, feeRecipient}: ProduceBlockV4Request
): Promise<ProduceBlockV4Result> {
  const fork = this.config.getForkName(slot);

  if (!isForkPostGloas(fork)) {
    throw new ApiError(400, `produceBlockV4 not supported for pre-gloas fork=${fork}`);
  }

  // [beacon-engine] deviation: syncing and slot waiting stay in the API.

  const parentBlock = this.getProposerHead(slot);
  const {blockRoot: parentBlockRootHex, slot: parentSlot} = parentBlock;
  // [beacon-engine] deviation: inspect the selected parent directly.
  if (parentBlock.dataAvailabilityStatus === DataAvailabilityStatus.OutOfRange) {
    throw new NodeIsSyncing("Block's data is out of range and not validated");
  }
  this.metrics?.blockProductionSlotDelta.set(slot - parentSlot);

  // [beacon-engine] deviation: the API supplies graffiti as bytes, including its default.
  const graffitiBytes = graffiti;

  // TODO GLOAS: respect builderSelection (MaxProfit, BuilderAlways, ExecutionAlways, etc.) to let
  // the user control bid source preferences and value comparison. Also add external builder api
  // support when it is implemented.
  const isBuildingOnFull = this.forkChoice.shouldBuildOnFull(parentBlock, slot);
  const bidParentBlockHash = isBuildingOnFull ? parentBlock.executionPayloadBlockHash : parentBlock.parentBlockHash;
  const builderBid = this.executionPayloadBidPool.getBestBid(slot, bidParentBlockHash, parentBlockRootHex);

  const logCtx = {
    slot,
    parentSlot,
    parentBlockRoot: parentBlockRootHex,
    parentBlockHash: parentBlock.executionPayloadBlockHash,
    fork,
    ...(builderBid !== null
      ? {
          bidValue: builderBid.message.value,
          builderIndex: builderBid.message.builderIndex,
          bidBlockHash: toRootHex(builderBid.message.blockHash),
        }
      : {}),
  };

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
    commonBlockBodyPromise,
  };

  this.metrics?.blockProductionRequests.inc({source: ProducedBlockSource.engine});
  if (builderBid !== null) {
    this.metrics?.blockProductionRequests.inc({source: ProducedBlockSource.builder});
  }

  const timed = <T>(source: ProducedBlockSource, fn: () => Promise<T>): Promise<T> => {
    const t = this.metrics?.blockProductionTime.startTimer();
    return fn().finally(() => t?.({source}));
  };

  // Always build local block. If builder bid available, also build with it in parallel and prefer it.
  const [engineResult, bidResult] = await Promise.allSettled([
    timed(ProducedBlockSource.engine, () => produceSelfBlock.call(this, baseAttrs)),
    builderBid !== null
      ? timed(ProducedBlockSource.builder, () => produceSelfBlock.call(this, {...baseAttrs, builderBid}))
      : Promise.reject(),
  ]);

  let bestResult: typeof engineResult | null = null;
  let source: ProducedBlockSource = ProducedBlockSource.engine;
  if (builderBid !== null && bidResult.status === "fulfilled") {
    source = ProducedBlockSource.builder;
    bestResult = bidResult;
    this.logger.info("Selected builder bid block", logCtx);
  } else if (engineResult.status === "fulfilled") {
    source = ProducedBlockSource.engine;
    bestResult = engineResult;
    if (builderBid !== null) {
      this.logger.warn("Builder bid block production failed, using local block", logCtx);
    }
  }

  if (bestResult === null || bestResult.status !== "fulfilled") {
    const engineReason = engineResult.status === "rejected" ? engineResult.reason : undefined;
    const bidReason = builderBid !== null && bidResult.status === "rejected" ? bidResult.reason : undefined;
    this.logger.error("Block production failed", {...logCtx, engineReason, bidReason});
    throw Error(`Block production failed: engine=${engineReason ?? "n/a"} builder=${bidReason ?? "n/a"}`);
  }

  // [beacon-engine] deviation: include the selected DA artifacts in the V4 result.
  const {block, executionPayloadValue, consensusBlockValue, produceResult} = bestResult.value;

  this.metrics?.blockProductionSuccess.inc({source});
  this.metrics?.blockProductionNumAggregated.observe({source}, block.body.attestations.length);
  this.metrics?.blockProductionConsensusBlockValue.observe({source}, Number(formatWeiToEth(consensusBlockValue)));
  this.metrics?.blockProductionExecutionPayloadValue.observe({source}, Number(formatWeiToEth(executionPayloadValue)));

  const blockRoot = toRootHex(this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block));
  this.logger.verbose("Produced block", {
    ...logCtx,
    executionPayloadValue,
    consensusBlockValue,
    root: blockRoot,
  });
  // [beacon-engine] deviation: the API persists the selected block.

  return {
    data: block as gloas.BeaconBlock,
    version: fork,
    consensusBlockValue,
    executionPayloadValue,
    executionPayloadSource: source,
    produceResult,
  };
}
