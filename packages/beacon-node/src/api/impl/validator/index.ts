import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {
  ForkName,
  ForkPostBellatrix,
  ForkPostDeneb,
  ForkPreDeneb,
  ForkSeq,
  GENESIS_SLOT,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
  SYNC_COMMITTEE_SUBNET_SIZE,
  isForkPostBellatrix,
  isForkPostDeneb,
  isForkPostElectra,
} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  DataAvailabilityStatus,
  attesterShufflingDecisionRoot,
  beaconBlockToBlinded,
  calculateCommitteeAssignments,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  createCachedBeaconState,
  getBlockRootAtSlot,
  getCurrentSlot,
  loadState,
  proposerShufflingDecisionRoot,
} from "@lodestar/state-transition";
import {
  BLSSignature,
  BeaconBlock,
  BlindedBeaconBlock,
  BlockContents,
  CommitteeIndex,
  Epoch,
  ProducedBlockSource,
  Root,
  Slot,
  ValidatorIndex,
  Wei,
  bellatrix,
  getValidatorStatus,
  isBlindedBeaconBlock,
  isBlockContents,
  phase0,
  ssz,
} from "@lodestar/types";
import {
  LogData,
  PromiseResult,
  TimeoutError,
  formatWeiToEth,
  fromHex,
  prettyWeiToEth,
  resolveOrRacePromises,
  toHex,
  toRootHex,
} from "@lodestar/utils";
import {MAX_BUILDER_BOOST_FACTOR} from "@lodestar/validator";
import {
  AttestationError,
  AttestationErrorCode,
  GossipAction,
  SyncCommitteeError,
  SyncCommitteeErrorCode,
} from "../../../chain/errors/index.js";
import {
  AssembledBlockBodyResponse,
  AssembledBlockResponse,
  BlockType,
  ChainEvent,
  CheckpointHex,
  CommonBlockBody,
} from "../../../chain/index.js";
import {SCHEDULER_LOOKAHEAD_FACTOR} from "../../../chain/prepareNextSlot.js";
import {BlockAttributes} from "../../../chain/produceBlock/index.js";
import {RegenCaller} from "../../../chain/regen/index.js";
import {validateApiAggregateAndProof} from "../../../chain/validation/index.js";
import {validateSyncCommitteeGossipContributionAndProof} from "../../../chain/validation/syncCommitteeContributionAndProof.js";
import {ZERO_HASH} from "../../../constants/index.js";
import {NoBidReceived} from "../../../execution/builder/http.js";
import {validateGossipFnRetryUnknownRoot} from "../../../network/processor/gossipHandlers.js";
import {CommitteeSubscription} from "../../../network/subnets/index.js";
import {SyncState} from "../../../sync/index.js";
import {isOptimisticBlock} from "../../../util/forkChoice.js";
import {getDefaultGraffiti, toGraffitiBuffer} from "../../../util/graffiti.js";
import {getLodestarClientVersion} from "../../../util/metadata.js";
import {ApiOptions} from "../../options.js";
import {getStateResponseWithRegen} from "../beacon/state/utils.js";
import {ApiError, NodeIsSyncing, OnlySupportedByDVT} from "../errors.js";
import {ApiModules} from "../types.js";
import {computeSubnetForCommitteesAtSlot, getPubkeysForIndices, selectBlockProductionSource} from "./utils.js";

/**
 * If the node is within this many epochs from the head, we declare it to be synced regardless of
 * the network sync state.
 *
 * This helps prevent attacks where nodes can convince us that we're syncing some non-existent
 * finalized head.
 *
 * TODO: Lighthouse uses 8 for the attack described above. However, 8 kills Lodestar since validators
 * can trigger regen to fast-forward head state 8 epochs to be immediately invalidated as sync sets
 * a new head. Then the checkpoint state cache grows unbounded with very different states (because
 * they are 8 epochs apart) and causes an OOM. Research a proper solution once regen and the state
 * caches are better.
 */
export const SYNC_TOLERANCE_EPOCHS = 1;

/**
 * Cutoff time to wait from start of the slot for execution and builder block production apis to resolve
 * Post this time, race execution and builder to pick whatever resolves first
 *
 * Empirically the builder block resolves in ~1.5+ seconds, and execution should resolve <1 sec.
 * So lowering the cutoff to 2.5 sec from 3 seconds to publish faster for successful proposal
 * as proposals post 4 seconds into the slot will likely be orphaned due to proposer boost reorg.
 */
const BLOCK_PRODUCTION_RACE_CUTOFF_MS = 2_500;
/** Overall timeout for execution and block production apis */
const BLOCK_PRODUCTION_RACE_TIMEOUT_MS = 12_000;

type ProduceBlockOrContentsRes = {executionPayloadValue: Wei; consensusBlockValue: Wei} & (
  | {data: BeaconBlock<ForkPreDeneb>; version: ForkPreDeneb}
  | {data: BlockContents; version: ForkPostDeneb}
);
type ProduceBlindedBlockRes = {executionPayloadValue: Wei; consensusBlockValue: Wei} & {
  data: BlindedBeaconBlock;
  version: ForkPostBellatrix;
};

type ProduceFullOrBlindedBlockOrContentsRes = {executionPayloadSource: ProducedBlockSource} & (
  | (ProduceBlockOrContentsRes & {executionPayloadBlinded: false})
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

type BlockProductionOptions = {
  slot: Slot;
  fork: ForkName;
  builderSelection: routes.validator.BuilderSelection;
  builderBoostFactor: bigint;
  isBuilderEnabled: boolean;
  isEngineEnabled: boolean;
};

/**
 * Dispatch table design to have fully type safe implementation for all possible cases of builder vs engine flow
 */
type EngineVsBuilderStatusMatrix<E extends PromiseResult<unknown>, B extends PromiseResult<unknown>, R> = {
  [S1 in E["status"] as `engine_${S1}`]: {
    [S2 in B["status"] as `builder_${S2}`]: (e: E & {status: S1}, b: B & {status: S2}) => Promise<R>;
  };
};

// biome-ignore lint/suspicious/noExplicitAny: We need `any` type to reuse other types of objects defined in closure
function executeMatrix(matrix: EngineVsBuilderStatusMatrix<any, any, any>, e: any, b: any): Promise<any> {
  return matrix[`engine_${e.status}`][`builder_${b.status}`](e, b);
}

/**
 * Server implementation for handling validator duties.
 * See `@lodestar/validator/src/api` for the client implementation).
 */
export function getValidatorApi(
  opts: ApiOptions,
  {chain, config, logger, metrics, network, sync}: ApiModules
): ApplicationMethods<routes.validator.Endpoints> {
  let genesisBlockRoot: Root | null = null;

  /**
   * Validator clock may be advanced from beacon's clock. If the validator requests a resource in a
   * future slot, wait some time instead of rejecting the request because it's in the future.
   * This value is the same to MAXIMUM_GOSSIP_CLOCK_DISPARITY_SEC.
   * For very fast networks, reduce clock disparity to half a slot.
   */
  const MAX_API_CLOCK_DISPARITY_SEC = Math.min(0.5, config.SECONDS_PER_SLOT / 2);
  const MAX_API_CLOCK_DISPARITY_MS = MAX_API_CLOCK_DISPARITY_SEC * 1000;

  /** Compute and cache the genesis block root */
  async function getGenesisBlockRoot(state: CachedBeaconStateAllForks): Promise<Root> {
    if (!genesisBlockRoot) {
      // Close to genesis the genesis block may not be available in the DB
      if (state.slot < SLOTS_PER_HISTORICAL_ROOT) {
        genesisBlockRoot = state.blockRoots.get(0);
      }

      const blockRes = await chain.getCanonicalBlockAtSlot(GENESIS_SLOT);
      if (blockRes) {
        genesisBlockRoot = config
          .getForkTypes(blockRes.block.message.slot)
          .SignedBeaconBlock.hashTreeRoot(blockRes.block);
      }
    }

    // If for some reason the genesisBlockRoot is not able don't prevent validators from
    // proposing or attesting. If the genesisBlockRoot is wrong, at worst it may trigger a re-fetch of the duties
    return genesisBlockRoot || ZERO_HASH;
  }

  /**
   * If advancing the local clock `MAX_API_CLOCK_DISPARITY_MS` ticks to the requested slot, wait for its start
   * Prevents the validator from getting errors from the API if the clock is a bit advanced
   */
  async function waitForSlot(slot: Slot): Promise<void> {
    if (slot <= 0) {
      return;
    }

    const slotStartSec = chain.genesisTime + slot * config.SECONDS_PER_SLOT;
    const msToSlot = slotStartSec * 1000 - Date.now();

    if (msToSlot > MAX_API_CLOCK_DISPARITY_MS) {
      throw Error(`Requested slot ${slot} is in the future`);
    }

    if (msToSlot > 0) {
      await chain.clock.waitForSlot(slot);
    }

    // else, clock already in slot or slot is in the past
  }

  /**
   * If advancing the local clock `MAX_API_CLOCK_DISPARITY_MS` ticks to the next epoch, wait for slot 0 of the next epoch.
   * Prevents a validator from not being able to get the attestater duties correctly if the beacon and validator clocks are off
   */
  async function waitForNextClosestEpoch(): Promise<void> {
    const toNextEpochMs = msToNextEpoch();
    if (toNextEpochMs > 0 && toNextEpochMs < MAX_API_CLOCK_DISPARITY_MS) {
      const nextEpoch = chain.clock.currentEpoch + 1;
      await chain.clock.waitForSlot(computeStartSlotAtEpoch(nextEpoch));
    }
  }

  /**
   * Compute ms to the next epoch.
   */
  function msToNextEpoch(): number {
    const nextEpoch = chain.clock.currentEpoch + 1;
    const secPerEpoch = SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT;
    const nextEpochStartSec = chain.genesisTime + nextEpoch * secPerEpoch;
    return nextEpochStartSec * 1000 - Date.now();
  }

  function currentEpochWithDisparity(): Epoch {
    return computeEpochAtSlot(getCurrentSlot(config, chain.genesisTime - MAX_API_CLOCK_DISPARITY_SEC));
  }

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
   * This function is called 1s before next epoch, usually at that time PrepareNextSlotScheduler finishes
   * so we should have checkpoint state, otherwise wait for up to the slot 1 of epoch.
   *      slot epoch        0            1
   *           |------------|------------|
   *                    ^  ^
   *                    |  |
   *                    |  |
   *                    | waitForCheckpointState (1s before slot 0 of epoch, wait until slot 1 of epoch)
   *                    |
   *              prepareNextSlot (4s before next slot)
   */
  async function waitForCheckpointState(cpHex: CheckpointHex): Promise<CachedBeaconStateAllForks | null> {
    const cpState = chain.regen.getCheckpointStateSync(cpHex);
    if (cpState) {
      return cpState;
    }
    const cp = {
      epoch: cpHex.epoch,
      root: fromHex(cpHex.rootHex),
    };
    const slot0 = computeStartSlotAtEpoch(cp.epoch);
    // if not, wait for ChainEvent.checkpoint event until slot 1 of epoch
    let listener: ((eventCp: phase0.Checkpoint) => void) | null = null;
    const foundCPState = await Promise.race([
      new Promise((resolve) => {
        listener = (eventCp) => {
          resolve(ssz.phase0.Checkpoint.equals(eventCp, cp));
        };
        chain.emitter.once(ChainEvent.checkpoint, listener);
      }),
      // in rare case, checkpoint state cache may happen up to 6s of slot 0 of epoch
      // so we wait for it until the slot 1 of epoch
      chain.clock.waitForSlot(slot0 + 1),
    ]);

    if (listener != null) {
      chain.emitter.off(ChainEvent.checkpoint, listener);
    }

    if (foundCPState === true) {
      return chain.regen.getCheckpointStateSync(cpHex);
    }

    return null;
  }

  /**
   * Reject any request while the node is syncing
   */
  function notWhileSyncing(): void {
    // Consider node synced before or close to genesis
    if (chain.clock.currentSlot < SLOTS_PER_EPOCH) {
      return;
    }

    const syncState = sync.state;
    switch (syncState) {
      case SyncState.SyncingFinalized:
      case SyncState.SyncingHead: {
        const currentSlot = chain.clock.currentSlot;
        const headSlot = chain.forkChoice.getHead().slot;
        if (currentSlot - headSlot > SYNC_TOLERANCE_EPOCHS * SLOTS_PER_EPOCH) {
          throw new NodeIsSyncing(`headSlot ${headSlot} currentSlot ${currentSlot}`);
        }

        return;
      }

      case SyncState.Synced:
        return;

      case SyncState.Stalled:
        throw new NodeIsSyncing("waiting for peers");
    }
  }

  /**
   * Post merge, the CL and EL could be out of step in the sync, and could result in
   * Syncing status of the chain head. To be precise:
   * 1. CL could be ahead of the EL, with the validity of head payload not yet verified
   * 2. CL could be on an invalid chain of execution blocks with a non-existent
   *    or non-available parent that never syncs up
   *
   * Both the above scenarios could be problematic and hence validator shouldn't participate
   * or weigh its vote on a head till it resolves to a Valid execution status.
   * Following activities should be skipped on an Optimistic head (with Syncing status):
   * 1. Attestation if targetRoot is optimistic
   * 2. SyncCommitteeContribution if if the root for which to produce contribution is Optimistic.
   * 3. ProduceBlock if the parentRoot (chain's current head is optimistic). However this doesn't
   *    need to be checked/aborted here as assembleBody would call EL's api for the latest
   *    executionStatus of the parentRoot. If still not validated, produceBlock will throw error.
   *
   * TODO/PENDING: SyncCommitteeSignatures should also be aborted, the best way to address this
   *   is still in flux and will be updated as and when other CL's figure this out.
   */

  function notOnOptimisticBlockRoot(beaconBlockRoot: Root): void {
    const protoBeaconBlock = chain.forkChoice.getBlock(beaconBlockRoot);
    if (!protoBeaconBlock) {
      throw new ApiError(404, `Block not in forkChoice, beaconBlockRoot=${toRootHex(beaconBlockRoot)}`);
    }

    if (protoBeaconBlock.executionStatus === ExecutionStatus.Syncing)
      throw new NodeIsSyncing(
        `Block's execution payload not yet validated, executionPayloadBlockHash=${protoBeaconBlock.executionPayloadBlockHash} number=${protoBeaconBlock.executionPayloadNumber}`
      );
  }

  function notOnOutOfRangeData(beaconBlockRoot: Root): void {
    const protoBeaconBlock = chain.forkChoice.getBlock(beaconBlockRoot);
    if (!protoBeaconBlock) {
      throw new ApiError(404, `Block not in forkChoice, beaconBlockRoot=${toRootHex(beaconBlockRoot)}`);
    }

    if (protoBeaconBlock.dataAvailabilityStatus === DataAvailabilityStatus.OutOfRange)
      throw new NodeIsSyncing("Block's data is out of range and not validated");
  }

  function normalizeBlockProductionOptions(opts: {
    slot: Slot;
    builderBoostFactor: bigint | undefined;
    builderSelection: routes.validator.BuilderSelection | undefined;
    forceBlockType?: BlockType;
  }): BlockProductionOptions {
    const {slot, forceBlockType, builderBoostFactor, builderSelection} = opts;
    // set some sensible opts
    // builderSelection will be deprecated and will run in mode MaxProfit if builder is enabled
    // and the actual selection will be determined using builderBoostFactor passed by the validator
    const selection = builderSelection ?? routes.validator.BuilderSelection.MaxProfit;
    const boost = builderBoostFactor ?? BigInt(100);

    if (boost > MAX_BUILDER_BOOST_FACTOR) {
      throw new ApiError(400, `Invalid builderBoostFactor=${boost} > MAX_BUILDER_BOOST_FACTOR`);
    }

    const fork = config.getForkName(slot);
    const isBuilderEnabled =
      forceBlockType === BlockType.Blinded ||
      (ForkSeq[fork] >= ForkSeq.bellatrix &&
        chain.executionBuilder !== undefined &&
        selection !== routes.validator.BuilderSelection.ExecutionOnly);

    // At any point either the builder or execution or both flows should be active.
    //
    // Ideally such a scenario should be prevented on startup, but proposerSettingsFile or keymanager
    // configurations could cause a validator pubkey to have builder disabled with builder selection builder only
    // (TODO: independently make sure such an options update is not successful for a validator pubkey)
    //
    // So if builder is disabled ignore builder selection of builder only if caused by user mistake
    // https://github.com/ChainSafe/lodestar/issues/6338
    const isEngineEnabled =
      forceBlockType === BlockType.Full ||
      !isBuilderEnabled ||
      selection !== routes.validator.BuilderSelection.BuilderOnly;

    if (!isEngineEnabled && !isBuilderEnabled) {
      throw Error(
        `Internal error: neither builder nor execution proposal flow activated (builderSelection=${selection})`
      );
    }

    return {slot, fork, builderSelection: selection, builderBoostFactor: boost, isBuilderEnabled, isEngineEnabled};
  }

  async function produceCommonBlockBody(
    blockAttributes: BlockAttributes,
    currentState: CachedBeaconStateAllForks,
    loggerContext: LogData
  ): Promise<CommonBlockBody> {
    return chain.produceCommonBlockBody({...blockAttributes, currentState}).then((commonBlockBody) => {
      logger.debug("Produced common block body", loggerContext);
      return commonBlockBody;
    });
  }

  async function produceBuilderBlockBody(
    blockAttributes: BlockAttributes,
    currentState: CachedBeaconStateAllForks,
    loggerContext: LogData
  ): Promise<AssembledBlockBodyResponse<BlockType.Blinded>> {
    // Error early for builder if builder flow not active
    if (!chain.executionBuilder) {
      throw Error("Execution builder not set");
    }

    if (!chain.executionBuilder.status) {
      throw Error("Execution builder disabled");
    }

    metrics?.blockProductionRequests.inc({source: ProducedBlockSource.builder});
    const builderBlockBody = await chain.produceBlindedBlockBody({...blockAttributes, currentState});
    metrics?.blockProductionSuccess.inc({source: ProducedBlockSource.builder});

    logger.debug("Produced builder block body", loggerContext);
    return builderBlockBody;
  }

  async function produceEngineBlockBody(
    blockAttributes: BlockAttributes,
    currentState: CachedBeaconStateAllForks,
    loggerContext: LogData
  ): Promise<AssembledBlockBodyResponse<BlockType.Full>> {
    metrics?.blockProductionRequests.inc({source: ProducedBlockSource.engine});
    const engineBlockBody = await chain.produceFullBlockBody({...blockAttributes, currentState});
    metrics?.blockProductionSuccess.inc({source: ProducedBlockSource.engine});

    logger.debug("Produced engine block body", loggerContext);
    return engineBlockBody;
  }

  async function produceAssembledBlock(
    blockAttributes: BlockAttributes,
    opts: BlockProductionOptions,
    loggerContext: Record<string, string | number | bigint | undefined | boolean>
  ): Promise<
    AssembledBlockResponse<BlockType> & {
      executionPayloadBlinded: boolean;
      executionPayloadSource: ProducedBlockSource;
    }
  > {
    const {parentBlockRoot, slot} = blockAttributes;
    const {isBuilderEnabled, isEngineEnabled, builderBoostFactor, builderSelection} = opts;
    const currentState = await chain.regen.getBlockSlotState(
      toRootHex(parentBlockRoot),
      slot,
      {dontTransferCache: true},
      RegenCaller.produceBlock
    );

    Object.assign(loggerContext, {isEngineEnabled, isBuilderEnabled});

    if (isEngineEnabled && !isBuilderEnabled) {
      const [commonBlockBody, engineBlockBodyResp] = await Promise.all([
        produceCommonBlockBody(blockAttributes, currentState, loggerContext),
        produceEngineBlockBody(blockAttributes, currentState, loggerContext),
      ]);

      const blockResp = await chain.assembleBlockBody(
        BlockType.Full,
        blockAttributes,
        currentState,
        commonBlockBody,
        engineBlockBodyResp
      );

      return {
        ...blockResp,
        executionPayloadBlinded: false,
        executionPayloadSource: ProducedBlockSource.engine,
      };
    }

    // Case 3
    if (!isEngineEnabled && isBuilderEnabled) {
      const [commonBlockBody, builderBlockBodyResp] = await Promise.all([
        produceCommonBlockBody(blockAttributes, currentState, loggerContext),
        produceBuilderBlockBody(blockAttributes, currentState, loggerContext),
      ]);

      const blockResp = await chain.assembleBlockBody(
        BlockType.Blinded,
        blockAttributes,
        currentState,
        commonBlockBody,
        builderBlockBodyResp
      );

      return {
        ...blockResp,
        executionPayloadBlinded: true,
        executionPayloadSource: ProducedBlockSource.builder,
      };
    }

    // Only Case 1 left, at this point of time we have both engine and builder enabled

    // Calculate cutoff time based on start of the slot
    const cutoffMs = Math.max(0, BLOCK_PRODUCTION_RACE_CUTOFF_MS - Math.round(chain.clock.secFromSlot(slot) * 1000));
    logger.verbose("Block production race (builder vs execution) starting", {
      ...loggerContext,
      cutoffMs,
      timeoutMs: BLOCK_PRODUCTION_RACE_TIMEOUT_MS,
    });

    // use abort controller to stop waiting for both block sources
    const controller = new AbortController();

    const [commonBlockBody, [builder, engine]] = await Promise.all([
      produceCommonBlockBody(blockAttributes, currentState, loggerContext),
      resolveOrRacePromises(
        [
          produceBuilderBlockBody(blockAttributes, currentState, loggerContext),
          produceEngineBlockBody(blockAttributes, currentState, loggerContext).then((engineBlockBody) => {
            // Once the engine returns a block, in the event of either:
            // - suspected builder censorship
            // - builder boost factor set to 0 or builder selection `executionalways`
            // we don't need to wait for builder block as engine block will always be selected
            if (
              engineBlockBody.shouldOverrideBuilder ||
              builderBoostFactor === BigInt(0) ||
              builderSelection === routes.validator.BuilderSelection.ExecutionAlways
            ) {
              controller.abort();
            }
            return engineBlockBody;
          }) as Promise<AssembledBlockBodyResponse<BlockType.Full>>,
        ],
        {
          resolveTimeoutMs: cutoffMs,
          raceTimeoutMs: BLOCK_PRODUCTION_RACE_TIMEOUT_MS,
          signal: controller.signal,
        }
      ),
    ]);

    async function selectBuilderBlock(
      reason: BuilderBlockSelectionReason,
      {executionPayloadBlinded}: {executionPayloadBlinded: boolean}
    ): Promise<
      AssembledBlockResponse<BlockType> & {
        executionPayloadBlinded: boolean;
        executionPayloadSource: ProducedBlockSource;
      }
    > {
      if (builder.status !== "fulfilled") throw new Error("Cannot select builder block, builder not fulfilled");

      const blockResp = await chain.assembleBlockBody(
        BlockType.Blinded,
        blockAttributes,
        currentState,
        commonBlockBody,
        builder.value
      );

      logger.info("Selected builder block", {
        reason,
        ...loggerContext,
        durationMs: builder.durationMs,
        ...getBlockValueLogInfo(blockResp),
      });

      metrics?.blockProductionSelectionResults.inc({
        source: ProducedBlockSource.builder,
        reason,
      });

      return {
        ...blockResp,
        executionPayloadBlinded,
        executionPayloadSource: ProducedBlockSource.builder,
      };
    }

    async function selectEngineBlock(
      reason: EngineBlockSelectionReason,
      {executionPayloadBlinded}: {executionPayloadBlinded: boolean}
    ): Promise<
      AssembledBlockResponse<BlockType> & {
        executionPayloadBlinded: boolean;
        executionPayloadSource: ProducedBlockSource;
      }
    > {
      if (engine.status !== "fulfilled") throw new Error("Cannot select engine block, engine not fulfilled");

      const blockResp = await chain.assembleBlockBody(
        BlockType.Full,
        blockAttributes,
        currentState,
        commonBlockBody,
        engine.value
      );

      logger.info("Selected builder block", {
        reason,
        ...loggerContext,
        durationMs: engine.durationMs,
        ...getBlockValueLogInfo(blockResp),
      });

      metrics?.blockProductionSelectionResults.inc({
        source: ProducedBlockSource.engine,
        reason,
      });

      return {
        ...blockResp,
        executionPayloadBlinded,
        executionPayloadSource: ProducedBlockSource.engine,
      };
    }

    const engineVsBuilderMatrix: EngineVsBuilderStatusMatrix<
      typeof engine,
      typeof builder,
      AssembledBlockResponse<BlockType> & {
        executionPayloadBlinded: boolean;
        executionPayloadSource: ProducedBlockSource;
      }
    > = {
      engine_pending: {
        builder_pending: async (_e, _b) => {
          throw Error("Builder and engine both failed to produce the block within timeout");
        },
        builder_rejected: async (_e, b) => {
          if (b.reason instanceof TimeoutError) {
            throw Error("Engine timed out while builder did not provide a bid");
          }
          throw new Error("Engine timed out while builder failed to produce the block");
        },
        builder_fulfilled: async () => {
          const reason = BuilderBlockSelectionReason.EnginePending;
          return selectBuilderBlock(reason, {executionPayloadBlinded: true});
        },
      },
      engine_rejected: {
        builder_pending: async () => {
          throw Error("Builder timed out while engine failed to produce the block");
        },
        builder_rejected: async () => {
          throw Error(
            `${isBuilderEnabled && isEngineEnabled ? "Builder and engine both" : isBuilderEnabled ? "Builder" : "Engine"} failed to produce the block`
          );
        },
        builder_fulfilled: async () => {
          const reason = BuilderBlockSelectionReason.EngineError;
          return selectBuilderBlock(reason, {executionPayloadBlinded: true});
        },
      },
      engine_fulfilled: {
        builder_pending: async () => {
          const reason = EngineBlockSelectionReason.BuilderPending;
          return selectEngineBlock(reason, {executionPayloadBlinded: false});
        },
        builder_rejected: async (_e, b) => {
          const reason =
            b.reason instanceof NoBidReceived
              ? EngineBlockSelectionReason.BuilderNoBid
              : b.reason instanceof TimeoutError
                ? EngineBlockSelectionReason.BuilderTimeout
                : EngineBlockSelectionReason.BuilderError;

          return selectEngineBlock(reason, {executionPayloadBlinded: false});
        },
        builder_fulfilled: async (e, b) => {
          if (e.value.shouldOverrideBuilder) {
            const reason = EngineBlockSelectionReason.BuilderCensorship;
            return selectEngineBlock(reason, {executionPayloadBlinded: false});
          }

          // TODO: Due to logic of computing `consensusBlockValue` we have to assemble both bodies here
          const [engineBlockResp, builderBlockResp] = await Promise.all([
            chain.assembleBlockBody(BlockType.Full, blockAttributes, currentState, commonBlockBody, e.value),
            chain.assembleBlockBody(BlockType.Blinded, blockAttributes, currentState, commonBlockBody, b.value),
          ]);

          const result = selectBlockProductionSource({
            engineBlockValue: e.value.executionPayloadValue + engineBlockResp.consensusBlockValue,
            builderBlockValue: b.value.executionPayloadValue + builderBlockResp.consensusBlockValue,
            builderBoostFactor,
            builderSelection,
          });
          const executionPayloadSource = result.source;

          if (executionPayloadSource === ProducedBlockSource.engine) {
            return selectEngineBlock(result.reason, {executionPayloadBlinded: false});
          }

          return selectBuilderBlock(result.reason, {executionPayloadBlinded: true});
        },
      },
    };

    return executeMatrix(engineVsBuilderMatrix, engine, builder);
  }

  async function produceEngineOrBuilderBlock({
    feeRecipient,
    builderSelection,
    strictFeeRecipientCheck,
    slot,
    randaoReveal,
    graffiti,
    builderBoostFactor,
    forceBlockType,
  }: routes.validator.ExtraProduceBlockOpts & {
    slot: Slot;
    randaoReveal: BLSSignature;
    graffiti?: string;
    // TODO deneb: skip randao verification
    skipRandaoVerification?: boolean;
    builderBoostFactor?: bigint;
    forceBlockType?: BlockType;
  }): Promise<ProduceFullOrBlindedBlockOrContentsRes> {
    notWhileSyncing();
    await waitForSlot(slot); // Must never request for a future slot > currentSlot

    const parentBlockRoot = fromHex(chain.getProposerHead(slot).blockRoot);
    notOnOutOfRangeData(parentBlockRoot);
    const ctx = normalizeBlockProductionOptions({slot, builderBoostFactor, builderSelection, forceBlockType});

    const blockAttributes: BlockAttributes = {
      feeRecipient,
      randaoReveal,
      graffiti: toGraffitiBuffer(
        graffiti ?? getDefaultGraffiti(getLodestarClientVersion(opts), chain.executionEngine.clientVersion, opts)
      ),
      parentBlockRoot,
      slot,
    };

    const loggerContext = {
      slot,
      fork: ctx.fork,
      builderSelection,
      strictFeeRecipientCheck,
      // winston logger doesn't like bigint
      builderBoostFactor: `${builderBoostFactor}`,
    };

    // Starting the process of block production
    const blockProductionTimer = metrics?.blockProductionTime.startTimer();
    const {block, executionPayloadValue, consensusBlockValue, executionPayloadSource, executionPayloadBlinded} =
      await produceAssembledBlock(blockAttributes, ctx, loggerContext);
    blockProductionTimer?.({source: executionPayloadSource});

    logger.verbose("Produced block", {
      slot: block.slot,
      executionPayloadValue,
      consensusBlockValue,
      root: toRootHex(config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block)),
    });

    metrics?.blockProductionNumAggregated.observe({source: executionPayloadSource}, block.body.attestations.length);
    metrics?.blockProductionExecutionPayloadValue.observe(
      {source: executionPayloadSource},
      Number(formatWeiToEth(executionPayloadValue))
    );

    const version = config.getForkName(block.slot);
    if (strictFeeRecipientCheck && feeRecipient && isForkPostBellatrix(version)) {
      const blockFeeRecipient = toHex((block as bellatrix.BeaconBlock).body.executionPayload.feeRecipient);
      if (blockFeeRecipient !== feeRecipient) {
        throw Error(`Invalid feeRecipient set in engine block expected=${feeRecipient} actual=${blockFeeRecipient}`);
      }
    }

    if (chain.opts.persistProducedBlocks) {
      void chain.persistBlock(block, "produced_engine_block");
    }

    if (isForkPostDeneb(version) && executionPayloadSource === ProducedBlockSource.engine) {
      const blockHash = toRootHex((block as bellatrix.BeaconBlock).body.executionPayload.blockHash);
      const contents = chain.producedContentsCache.get(blockHash);
      if (contents === undefined) {
        throw Error("contents missing in cache");
      }

      return {
        data: {block, ...contents} as BlockContents,
        version,
        executionPayloadValue,
        consensusBlockValue,
        executionPayloadSource,
        executionPayloadBlinded,
      } as ProduceFullOrBlindedBlockOrContentsRes;
    }

    return {
      data: block,
      version,
      executionPayloadValue,
      consensusBlockValue,
      executionPayloadSource,
      executionPayloadBlinded,
    } as ProduceFullOrBlindedBlockOrContentsRes;
  }

  return {
    async produceBlockV2({slot, randaoReveal, feeRecipient, graffiti}) {
      const {data, ...meta} = await produceEngineOrBuilderBlock({
        slot,
        feeRecipient,
        graffiti,
        randaoReveal,
        forceBlockType: BlockType.Full,
      });

      return {data, meta};
    },

    async produceBlockV3({
      slot,
      randaoReveal,
      graffiti,
      skipRandaoVerification,
      builderBoostFactor,
      builderSelection,
      ...opts
    }) {
      const {data, ...meta} = await produceEngineOrBuilderBlock({
        slot,
        randaoReveal,
        graffiti,
        skipRandaoVerification,
        builderBoostFactor,
        builderSelection,
      });

      if (opts.blindedLocal === true && ForkSeq[meta.version] >= ForkSeq.bellatrix) {
        if (meta.executionPayloadBlinded) {
          return {data, meta};
        }

        if (isBlockContents(data)) {
          const {block} = data;
          const blindedBlock = beaconBlockToBlinded(config, block as BeaconBlock<ForkPostBellatrix>);
          return {
            data: blindedBlock,
            meta: {...meta, executionPayloadBlinded: true},
          };
        }

        const blindedBlock = beaconBlockToBlinded(config, data as BeaconBlock<ForkPostBellatrix>);
        return {
          data: blindedBlock,
          meta: {...meta, executionPayloadBlinded: true},
        };
      }

      return {data, meta};
    },

    async produceBlindedBlock({slot, randaoReveal, graffiti}) {
      const {data, version} = await produceEngineOrBuilderBlock({
        slot,
        randaoReveal,
        graffiti,
        forceBlockType: BlockType.Blinded,
      });

      if (!isForkPostBellatrix(version)) {
        throw Error(`Invalid fork=${version} for produceBlindedBlock`);
      }

      if (isBlockContents(data)) {
        const {block} = data;
        const blindedBlock = beaconBlockToBlinded(config, block as BeaconBlock<ForkPostBellatrix>);
        return {data: blindedBlock, meta: {version}};
      }

      if (isBlindedBeaconBlock(data)) {
        return {data, meta: {version}};
      }

      const blindedBlock = beaconBlockToBlinded(config, data as BeaconBlock<ForkPostBellatrix>);
      return {data: blindedBlock, meta: {version}};
    },

    async produceAttestationData({committeeIndex, slot}) {
      notWhileSyncing();

      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      // This needs a state in the same epoch as `slot` such that state.currentJustifiedCheckpoint is correct.
      // Note: This may trigger an epoch transition if there skipped slots at the beginning of the epoch.
      const headState = chain.getHeadState();
      const headSlot = headState.slot;
      const attEpoch = computeEpochAtSlot(slot);
      const headBlockRootHex = chain.forkChoice.getHead().blockRoot;
      const headBlockRoot = fromHex(headBlockRootHex);
      const fork = config.getForkName(slot);

      let index: CommitteeIndex;
      if (isForkPostElectra(fork)) {
        index = 0;
      } else {
        if (committeeIndex === undefined) {
          throw new ApiError(400, `Committee index must be provided for pre-electra fork=${fork}`);
        }
        index = committeeIndex;
      }

      const beaconBlockRoot =
        slot >= headSlot
          ? // When attesting to the head slot or later, always use the head of the chain.
            headBlockRoot
          : // Permit attesting to slots *prior* to the current head. This is desirable when
            // the VC and BN are out-of-sync due to time issues or overloading.
            getBlockRootAtSlot(headState, slot);

      const targetSlot = computeStartSlotAtEpoch(attEpoch);
      const targetRoot =
        targetSlot >= headSlot
          ? // If the state is earlier than the target slot then the target *must* be the head block root.
            headBlockRoot
          : getBlockRootAtSlot(headState, targetSlot);

      // Check the execution status as validator shouldn't vote on an optimistic head
      // Check on target is sufficient as a valid target would imply a valid source
      notOnOptimisticBlockRoot(targetRoot);
      notOnOutOfRangeData(targetRoot);

      // To get the correct source we must get a state in the same epoch as the attestation's epoch.
      // An epoch transition may change state.currentJustifiedCheckpoint
      const attEpochState = await chain.getHeadStateAtEpoch(attEpoch, RegenCaller.produceAttestationData);

      // TODO confirm if the below is correct assertion
      // notOnOutOfRangeData(attEpochState.currentJustifiedCheckpoint.root);

      return {
        data: {
          slot,
          index,
          beaconBlockRoot,
          source: attEpochState.currentJustifiedCheckpoint,
          target: {epoch: attEpoch, root: targetRoot},
        },
      };
    },

    /**
     * GET `/eth/v1/validator/sync_committee_contribution`
     *
     * Requests that the beacon node produce a sync committee contribution.
     *
     * https://github.com/ethereum/beacon-APIs/pull/138
     *
     * @param slot The slot for which a sync committee contribution should be created.
     * @param subcommitteeIndex The subcommittee index for which to produce the contribution.
     * @param beaconBlockRoot The block root for which to produce the contribution.
     */
    async produceSyncCommitteeContribution({slot, subcommitteeIndex, beaconBlockRoot}) {
      // when a validator is configured with multiple beacon node urls, this beaconBlockRoot may come from another beacon node
      // and it hasn't been in our forkchoice since we haven't seen / processing that block
      // see https://github.com/ChainSafe/lodestar/issues/5063
      if (!chain.forkChoice.hasBlock(beaconBlockRoot)) {
        const rootHex = toRootHex(beaconBlockRoot);
        network.searchUnknownSlotRoot({slot, root: rootHex});
        // if result of this call is false, i.e. block hasn't seen after 1 slot then the below notOnOptimisticBlockRoot call will throw error
        await chain.waitForBlock(slot, rootHex);
      }

      // Check the execution status as validator shouldn't contribute on an optimistic head
      notOnOptimisticBlockRoot(beaconBlockRoot);
      notOnOutOfRangeData(beaconBlockRoot);

      const contribution = chain.syncCommitteeMessagePool.getContribution(subcommitteeIndex, slot, beaconBlockRoot);
      if (!contribution) {
        throw new ApiError(
          404,
          `No sync committee contribution for slot=${slot}, subnet=${subcommitteeIndex}, beaconBlockRoot=${toRootHex(beaconBlockRoot)}`
        );
      }

      metrics?.production.producedSyncContributionParticipants.observe(
        contribution.aggregationBits.getTrueBitIndexes().length
      );

      return {data: contribution};
    },

    async getProposerDuties({epoch}) {
      notWhileSyncing();

      // Early check that epoch is no more than current_epoch + 1, or allow for pre-genesis
      const currentEpoch = currentEpochWithDisparity();
      const nextEpoch = currentEpoch + 1;
      if (currentEpoch >= 0 && epoch > nextEpoch) {
        throw new ApiError(400, `Requested epoch ${epoch} must not be more than one epoch in the future`);
      }

      const head = chain.forkChoice.getHead();
      let state: CachedBeaconStateAllForks | undefined = undefined;
      const startSlot = computeStartSlotAtEpoch(epoch);
      const slotMs = config.SECONDS_PER_SLOT * 1000;
      const prepareNextSlotLookAheadMs = slotMs / SCHEDULER_LOOKAHEAD_FACTOR;
      const toNextEpochMs = msToNextEpoch();
      // validators may request next epoch's duties when it's close to next epoch
      // this is to avoid missed block proposal due to 0 epoch look ahead
      if (epoch === nextEpoch && toNextEpochMs < prepareNextSlotLookAheadMs) {
        // wait for maximum 1 slot for cp state which is the timeout of validator api
        const cpState = await waitForCheckpointState({rootHex: head.blockRoot, epoch});
        if (cpState) {
          state = cpState;
          metrics?.duties.requestNextEpochProposalDutiesHit.inc();
        } else {
          metrics?.duties.requestNextEpochProposalDutiesMiss.inc();
        }
      }

      if (!state) {
        if (epoch >= currentEpoch - 1) {
          // Cached beacon state stores proposers for previous, current and next epoch. The
          // requested epoch is within that range, we can use the head state at current epoch
          state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.getDuties);
        } else {
          const res = await getStateResponseWithRegen(chain, startSlot);

          const stateViewDU =
            res.state instanceof Uint8Array
              ? loadState(config, chain.getHeadState(), res.state).state
              : res.state.clone();

          state = createCachedBeaconState(
            stateViewDU,
            {
              config: chain.config,
              // Not required to compute proposers
              pubkey2index: new PubkeyIndexMap(),
              index2pubkey: [],
            },
            {skipSyncPubkeys: true, skipSyncCommitteeCache: true}
          );

          if (state.epochCtx.epoch !== epoch) {
            throw Error(`Loaded state epoch ${state.epochCtx.epoch} does not match requested epoch ${epoch}`);
          }
        }
      }

      const stateEpoch = state.epochCtx.epoch;
      let indexes: ValidatorIndex[] = [];

      switch (epoch) {
        case stateEpoch:
          indexes = state.epochCtx.getBeaconProposers();
          break;

        case stateEpoch + 1:
          // make sure shuffling is calculated and ready for next call to calculate nextProposers
          await chain.shufflingCache.get(state.epochCtx.nextEpoch, state.epochCtx.nextDecisionRoot);
          // Requesting duties for next epoch is allowed since they can be predicted with high probabilities.
          // @see `epochCtx.getBeaconProposersNextEpoch` JSDocs for rationale.
          indexes = state.epochCtx.getBeaconProposersNextEpoch();
          break;

        case stateEpoch - 1: {
          const indexesPrevEpoch = state.epochCtx.getBeaconProposersPrevEpoch();
          if (indexesPrevEpoch === null) {
            // Should not happen as previous proposer duties should be initialized for head state
            // and if we load state from `Uint8Array` it will always be the state of requested epoch
            throw Error(`Proposer duties for previous epoch ${epoch} not yet initialized`);
          }
          indexes = indexesPrevEpoch;
          break;
        }

        default:
          // Should never happen, epoch is checked to be in bounds above
          throw Error(`Proposer duties for epoch ${epoch} not supported, current epoch ${stateEpoch}`);
      }

      // NOTE: this is the fastest way of getting compressed pubkeys.
      //       See benchmark -> packages/lodestar/test/perf/api/impl/validator/attester.test.ts
      // After dropping the flat caches attached to the CachedBeaconState it's no longer available.
      // TODO: Add a flag to just send 0x00 as pubkeys since the Lodestar validator does not need them.
      const pubkeys = getPubkeysForIndices(state.validators, indexes);

      const duties: routes.validator.ProposerDuty[] = [];
      for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
        duties.push({slot: startSlot + i, validatorIndex: indexes[i], pubkey: pubkeys[i]});
      }

      // Returns `null` on the one-off scenario where the genesis block decides its own shuffling.
      // It should be set to the latest block applied to `self` or the genesis block root.
      const dependentRoot = proposerShufflingDecisionRoot(state) || (await getGenesisBlockRoot(state));

      return {
        data: duties,
        meta: {
          dependentRoot: toRootHex(dependentRoot),
          executionOptimistic: isOptimisticBlock(head),
        },
      };
    },

    async getAttesterDuties({epoch, indices}) {
      notWhileSyncing();

      if (indices.length === 0) {
        throw new ApiError(400, "No validator to get attester duties");
      }

      // May request for an epoch that's in the future
      await waitForNextClosestEpoch();

      // should not compare to headEpoch in order to handle skipped slots
      // Check if the epoch is in the future after waiting for requested slot
      if (epoch > chain.clock.currentEpoch + 1) {
        throw new ApiError(400, "Cannot get duties for epoch more than one ahead");
      }

      const head = chain.forkChoice.getHead();
      const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.getDuties);

      // TODO: Determine what the current epoch would be if we fast-forward our system clock by
      // `MAXIMUM_GOSSIP_CLOCK_DISPARITY`.
      //
      // Most of the time, `tolerantCurrentEpoch` will be equal to `currentEpoch`. However, during
      // the first `MAXIMUM_GOSSIP_CLOCK_DISPARITY` duration of the epoch `tolerantCurrentEpoch`
      // will equal `currentEpoch + 1`

      // Check that all validatorIndex belong to the state before calling getCommitteeAssignments()
      const pubkeys = getPubkeysForIndices(state.validators, indices);
      const decisionRoot = state.epochCtx.getShufflingDecisionRoot(epoch);
      const shuffling = await chain.shufflingCache.get(epoch, decisionRoot);
      if (!shuffling) {
        throw new ApiError(
          500,
          `No shuffling found to calculate committee assignments for epoch: ${epoch} and decisionRoot: ${decisionRoot}`
        );
      }
      const committeeAssignments = calculateCommitteeAssignments(shuffling, indices);
      const duties: routes.validator.AttesterDuty[] = [];
      for (let i = 0, len = indices.length; i < len; i++) {
        const validatorIndex = indices[i];
        const duty = committeeAssignments.get(validatorIndex) as routes.validator.AttesterDuty | undefined;
        if (duty) {
          // Mutate existing object instead of re-creating another new object with spread operator
          // Should be faster and require less memory
          duty.pubkey = pubkeys[i];
          duties.push(duty);
        }
      }

      const dependentRoot = attesterShufflingDecisionRoot(state, epoch) || (await getGenesisBlockRoot(state));

      return {
        data: duties,
        meta: {
          dependentRoot: toRootHex(dependentRoot),
          executionOptimistic: isOptimisticBlock(head),
        },
      };
    },

    /**
     * `POST /eth/v1/validator/duties/sync/{epoch}`
     *
     * Requests the beacon node to provide a set of sync committee duties for a particular epoch.
     * - Although pubkey can be inferred from the index we return it to keep this call analogous with the one that
     *   fetches attester duties.
     * - `sync_committee_index` is the index of the validator in the sync committee. This can be used to infer the
     *   subnet to which the contribution should be broadcast. Note, there can be multiple per validator.
     *
     * https://github.com/ethereum/beacon-APIs/pull/134
     *
     * @param validatorIndices an array of the validator indices for which to obtain the duties.
     */
    async getSyncCommitteeDuties({epoch, indices}) {
      notWhileSyncing();

      if (indices.length === 0) {
        throw new ApiError(400, "No validator to get attester duties");
      }

      // May request for an epoch that's in the future
      await waitForNextClosestEpoch();

      // sync committee duties have a lookahead of 1 day. Assuming the validator only requests duties for upcoming
      // epochs, the head state will very likely have the duties available for the requested epoch.
      // Note: does not support requesting past duties
      const head = chain.forkChoice.getHead();
      const state = chain.getHeadState();

      // Check that all validatorIndex belong to the state before calling getCommitteeAssignments()
      const pubkeys = getPubkeysForIndices(state.validators, indices);
      // Ensures `epoch // EPOCHS_PER_SYNC_COMMITTEE_PERIOD <= current_epoch // EPOCHS_PER_SYNC_COMMITTEE_PERIOD + 1`
      const syncCommitteeCache = state.epochCtx.getIndexedSyncCommitteeAtEpoch(epoch);
      const syncCommitteeValidatorIndexMap = syncCommitteeCache.validatorIndexMap;

      const duties: routes.validator.SyncDuty[] = [];
      for (let i = 0, len = indices.length; i < len; i++) {
        const validatorIndex = indices[i];
        const validatorSyncCommitteeIndices = syncCommitteeValidatorIndexMap.get(validatorIndex);
        if (validatorSyncCommitteeIndices) {
          duties.push({
            pubkey: pubkeys[i],
            validatorIndex,
            validatorSyncCommitteeIndices,
          });
        }
      }

      return {
        data: duties,
        meta: {executionOptimistic: isOptimisticBlock(head)},
      };
    },

    async getAggregatedAttestation({attestationDataRoot, slot}) {
      notWhileSyncing();

      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      const dataRootHex = toRootHex(attestationDataRoot);
      const aggregate = chain.attestationPool.getAggregate(slot, dataRootHex, null);
      const fork = chain.config.getForkName(slot);

      if (isForkPostElectra(fork)) {
        throw new ApiError(
          400,
          `Use getAggregatedAttestationV2 to retrieve aggregated attestations for post-electra fork=${fork}`
        );
      }

      if (!aggregate) {
        throw new ApiError(404, `No aggregated attestation for slot=${slot}, dataRoot=${dataRootHex}`);
      }

      metrics?.production.producedAggregateParticipants.observe(aggregate.aggregationBits.getTrueBitIndexes().length);

      return {
        data: aggregate,
      };
    },

    async getAggregatedAttestationV2({attestationDataRoot, slot, committeeIndex}) {
      notWhileSyncing();

      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      const dataRootHex = toRootHex(attestationDataRoot);
      const aggregate = chain.attestationPool.getAggregate(slot, dataRootHex, committeeIndex);

      if (!aggregate) {
        throw new ApiError(
          404,
          `No aggregated attestation for slot=${slot}, dataRoot=${dataRootHex}, committeeIndex=${committeeIndex}`
        );
      }

      metrics?.production.producedAggregateParticipants.observe(aggregate.aggregationBits.getTrueBitIndexes().length);

      return {
        data: aggregate,
        meta: {version: config.getForkName(slot)},
      };
    },

    async publishAggregateAndProofs({signedAggregateAndProofs}) {
      await this.publishAggregateAndProofsV2({signedAggregateAndProofs});
    },

    async publishAggregateAndProofsV2({signedAggregateAndProofs}) {
      notWhileSyncing();

      const seenTimestampSec = Date.now() / 1000;
      const errors: Error[] = [];
      const fork = chain.config.getForkName(chain.clock.currentSlot);

      await Promise.all(
        signedAggregateAndProofs.map(async (signedAggregateAndProof, i) => {
          try {
            // TODO: Validate in batch
            const validateFn = () => validateApiAggregateAndProof(fork, chain, signedAggregateAndProof);
            const {slot, beaconBlockRoot} = signedAggregateAndProof.message.aggregate.data;
            // when a validator is configured with multiple beacon node urls, this attestation may come from another beacon node
            // and the block hasn't been in our forkchoice since we haven't seen / processing that block
            // see https://github.com/ChainSafe/lodestar/issues/5098
            const {indexedAttestation, committeeIndices, attDataRootHex} = await validateGossipFnRetryUnknownRoot(
              validateFn,
              network,
              chain,
              slot,
              beaconBlockRoot
            );

            const insertOutcome = chain.aggregatedAttestationPool.add(
              signedAggregateAndProof.message.aggregate,
              attDataRootHex,
              indexedAttestation.attestingIndices.length,
              committeeIndices
            );
            metrics?.opPool.aggregatedAttestationPool.apiInsertOutcome.inc({insertOutcome});

            const sentPeers = await network.publishBeaconAggregateAndProof(signedAggregateAndProof);
            chain.validatorMonitor?.onPoolSubmitAggregatedAttestation(seenTimestampSec, indexedAttestation, sentPeers);
          } catch (e) {
            const logCtx = {
              slot: signedAggregateAndProof.message.aggregate.data.slot,
              index: signedAggregateAndProof.message.aggregate.data.index,
            };

            if (e instanceof AttestationError && e.type.code === AttestationErrorCode.AGGREGATOR_ALREADY_KNOWN) {
              logger.debug("Ignoring known signedAggregateAndProof", logCtx);
              return; // Ok to submit the same aggregate twice
            }

            errors.push(e as Error);
            logger.error(`Error on publishAggregateAndProofs [${i}]`, logCtx, e as Error);
            if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
              chain.persistInvalidSszValue(ssz.phase0.SignedAggregateAndProof, signedAggregateAndProof, "api_reject");
            }
          }
        })
      );

      if (errors.length > 1) {
        throw Error("Multiple errors on publishAggregateAndProofs\n" + errors.map((e) => e.message).join("\n"));
      }

      if (errors.length === 1) {
        throw errors[0];
      }
    },

    /**
     * POST `/eth/v1/validator/contribution_and_proofs`
     *
     * Publish multiple signed sync committee contribution and proofs
     *
     * https://github.com/ethereum/beacon-APIs/pull/137
     */
    async publishContributionAndProofs({contributionAndProofs}) {
      notWhileSyncing();

      const errors: Error[] = [];

      await Promise.all(
        contributionAndProofs.map(async (contributionAndProof, i) => {
          try {
            // TODO: Validate in batch
            const {syncCommitteeParticipantIndices} = await validateSyncCommitteeGossipContributionAndProof(
              chain,
              contributionAndProof,
              true // skip known participants check
            );
            chain.syncContributionAndProofPool.add(
              contributionAndProof.message,
              syncCommitteeParticipantIndices.length
            );
            await network.publishContributionAndProof(contributionAndProof);
          } catch (e) {
            const logCtx = {
              slot: contributionAndProof.message.contribution.slot,
              subcommitteeIndex: contributionAndProof.message.contribution.subcommitteeIndex,
            };

            if (
              e instanceof SyncCommitteeError &&
              e.type.code === SyncCommitteeErrorCode.SYNC_COMMITTEE_AGGREGATOR_ALREADY_KNOWN
            ) {
              logger.debug("Ignoring known contributionAndProof", logCtx);
              return; // Ok to submit the same aggregate twice
            }

            errors.push(e as Error);
            logger.error(`Error on publishContributionAndProofs [${i}]`, logCtx, e as Error);
            if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
              chain.persistInvalidSszValue(ssz.altair.SignedContributionAndProof, contributionAndProof, "api_reject");
            }
          }
        })
      );

      if (errors.length > 1) {
        throw Error("Multiple errors on publishContributionAndProofs\n" + errors.map((e) => e.message).join("\n"));
      }

      if (errors.length === 1) {
        throw errors[0];
      }
    },

    async prepareBeaconCommitteeSubnet({subscriptions}) {
      notWhileSyncing();

      await network.prepareBeaconCommitteeSubnets(
        subscriptions.map(({validatorIndex, slot, isAggregator, committeesAtSlot, committeeIndex}) => ({
          validatorIndex: validatorIndex,
          subnet: computeSubnetForCommitteesAtSlot(slot, committeesAtSlot, committeeIndex),
          slot: slot,
          isAggregator: isAggregator,
        }))
      );

      // TODO:
      // If the discovery mechanism isn't disabled, attempt to set up a peer discovery for the
      // required subnets.

      if (metrics) {
        for (const subscription of subscriptions) {
          chain.validatorMonitor?.registerLocalValidator(subscription.validatorIndex);
        }
      }
    },

    /**
     * POST `/eth/v1/validator/sync_committee_subscriptions`
     *
     * Subscribe to a number of sync committee subnets.
     * Sync committees are not present in phase0, but are required for Altair networks.
     * Subscribing to sync committee subnets is an action performed by VC to enable network participation in Altair networks,
     * and only required if the VC has an active validator in an active sync committee.
     *
     * https://github.com/ethereum/beacon-APIs/pull/136
     */
    async prepareSyncCommitteeSubnets({subscriptions}) {
      notWhileSyncing();

      // A `validatorIndex` can be in multiple subnets, so compute the CommitteeSubscription with double for loop
      const subs: CommitteeSubscription[] = [];
      for (const sub of subscriptions) {
        for (const committeeIndex of sub.syncCommitteeIndices) {
          const subnet = Math.floor(committeeIndex / SYNC_COMMITTEE_SUBNET_SIZE);
          subs.push({
            validatorIndex: sub.validatorIndex,
            subnet: subnet,
            // Subscribe until the end of `untilEpoch`: https://github.com/ethereum/beacon-APIs/pull/136#issuecomment-840315097
            slot: computeStartSlotAtEpoch(sub.untilEpoch + 1),
            isAggregator: true,
          });
        }
      }

      await network.prepareSyncCommitteeSubnets(subs);

      if (metrics) {
        for (const subscription of subscriptions) {
          chain.validatorMonitor?.registerLocalValidatorInSyncCommittee(
            subscription.validatorIndex,
            subscription.untilEpoch
          );
        }
      }
    },

    async prepareBeaconProposer({proposers}) {
      await chain.updateBeaconProposerData(chain.clock.currentEpoch, proposers);
    },

    async submitBeaconCommitteeSelections() {
      throw new OnlySupportedByDVT();
    },

    async submitSyncCommitteeSelections() {
      throw new OnlySupportedByDVT();
    },

    async getLiveness({epoch, indices}) {
      if (indices.length === 0) {
        return {
          data: [],
        };
      }
      const currentEpoch = chain.clock.currentEpoch;
      if (epoch < currentEpoch - 1 || epoch > currentEpoch + 1) {
        throw new ApiError(
          400,
          `Request epoch ${epoch} is more than one epoch before or after the current epoch ${currentEpoch}`
        );
      }

      return {
        data: indices.map((index) => ({
          index,
          isLive: chain.validatorSeenAtEpoch(index, epoch),
        })),
      };
    },

    async registerValidator({registrations}) {
      if (!chain.executionBuilder) {
        throw Error("Execution builder not enabled");
      }

      // should only send active or pending validator to builder
      // Spec: https://ethereum.github.io/builder-specs/#/Builder/registerValidator
      const headState = chain.getHeadState();
      const currentEpoch = chain.clock.currentEpoch;

      const filteredRegistrations = registrations.filter((registration) => {
        const {pubkey} = registration.message;
        const validatorIndex = headState.epochCtx.pubkey2index.get(pubkey);
        if (validatorIndex === null) return false;

        const validator = headState.validators.getReadonly(validatorIndex);
        const status = getValidatorStatus(validator, currentEpoch);
        return (
          status === "active_exiting" ||
          status === "active_ongoing" ||
          status === "active_slashed" ||
          status === "pending_initialized" ||
          status === "pending_queued"
        );
      });

      await chain.executionBuilder.registerValidator(currentEpoch, filteredRegistrations);

      logger.debug("Forwarded validator registrations to connected builder", {
        epoch: currentEpoch,
        count: filteredRegistrations.length,
      });
    },
  };
}
