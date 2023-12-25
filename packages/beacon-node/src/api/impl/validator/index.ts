import {fromHexString, toHexString} from "@chainsafe/ssz";
import {routes, ServerApi} from "@lodestar/api";
import {
  CachedBeaconStateAllForks,
  computeStartSlotAtEpoch,
  proposerShufflingDecisionRoot,
  attesterShufflingDecisionRoot,
  getBlockRootAtSlot,
  computeEpochAtSlot,
  getCurrentSlot,
  beaconBlockToBlinded,
} from "@lodestar/state-transition";
import {
  GENESIS_SLOT,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
  SYNC_COMMITTEE_SUBNET_SIZE,
  isForkBlobs,
  isForkExecution,
  ForkSeq,
} from "@lodestar/params";
import {
  Root,
  Slot,
  ValidatorIndex,
  ssz,
  Epoch,
  ProducedBlockSource,
  bellatrix,
  allForks,
  BLSSignature,
  isBlindedBeaconBlock,
  isBlockContents,
  phase0,
} from "@lodestar/types";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {toHex, racePromisesWithCutoff, RaceEvent, gweiToWei} from "@lodestar/utils";
import {AttestationError, AttestationErrorCode, GossipAction, SyncCommitteeError} from "../../../chain/errors/index.js";
import {validateApiAggregateAndProof} from "../../../chain/validation/index.js";
import {ZERO_HASH} from "../../../constants/index.js";
import {SyncState} from "../../../sync/index.js";
import {isOptimisticBlock} from "../../../util/forkChoice.js";
import {toGraffitiBuffer} from "../../../util/graffiti.js";
import {ApiError, NodeIsSyncing, OnlySupportedByDVT} from "../errors.js";
import {validateSyncCommitteeGossipContributionAndProof} from "../../../chain/validation/syncCommitteeContributionAndProof.js";
import {CommitteeSubscription} from "../../../network/subnets/index.js";
import {ApiModules} from "../types.js";
import {RegenCaller} from "../../../chain/regen/index.js";
import {getValidatorStatus} from "../beacon/state/utils.js";
import {validateGossipFnRetryUnknownRoot} from "../../../network/processor/gossipHandlers.js";
import {SCHEDULER_LOOKAHEAD_FACTOR} from "../../../chain/prepareNextSlot.js";
import {ChainEvent, CheckpointHex} from "../../../chain/index.js";
import {computeSubnetForCommitteesAtSlot, getPubkeysForIndices} from "./utils.js";

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
const SYNC_TOLERANCE_EPOCHS = 1;

/**
 * Cutoff time to wait for execution and builder block production apis to resolve
 * Post this time, race execution and builder to pick whatever resolves first
 *
 * Empirically the builder block resolves in ~1.5+ seconds, and execution should resolve <1 sec.
 * So lowering the cutoff to 2 sec from 3 seconds to publish faster for successful proposal
 * as proposals post 4 seconds into the slot seems to be not being included
 */
const BLOCK_PRODUCTION_RACE_CUTOFF_MS = 2_000;
/** Overall timeout for execution and block production apis */
const BLOCK_PRODUCTION_RACE_TIMEOUT_MS = 12_000;

/**
 * Server implementation for handling validator duties.
 * See `@lodestar/validator/src/api` for the client implementation).
 */
export function getValidatorApi({
  chain,
  config,
  logger,
  metrics,
  network,
  sync,
}: ApiModules): ServerApi<routes.validator.Api> {
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
    } else if (msToSlot > 0) {
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
      root: fromHexString(cpHex.rootHex),
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
        } else {
          return;
        }
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
      throw new ApiError(400, "Block not in forkChoice");
    }

    if (protoBeaconBlock.executionStatus === ExecutionStatus.Syncing)
      throw new NodeIsSyncing(
        `Block's execution payload not yet validated, executionPayloadBlockHash=${protoBeaconBlock.executionPayloadBlockHash} number=${protoBeaconBlock.executionPayloadNumber}`
      );
  }

  const produceBuilderBlindedBlock = async function produceBuilderBlindedBlock(
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string,
    // as of now fee recipient checks can not be performed because builder does not return bid recipient
    {
      skipHeadChecksAndUpdate,
    }: Omit<routes.validator.ExtraProduceBlockOps, "builderSelection"> & {skipHeadChecksAndUpdate?: boolean} = {}
  ): Promise<routes.validator.ProduceBlindedBlockRes> {
    const version = config.getForkName(slot);
    if (!isForkExecution(version)) {
      throw Error(`Invalid fork=${version} for produceBuilderBlindedBlock`);
    }

    const source = ProducedBlockSource.builder;
    metrics?.blockProductionRequests.inc({source});

    // Error early for builder if builder flow not active
    if (!chain.executionBuilder) {
      throw Error("Execution builder not set");
    }
    if (!chain.executionBuilder.status) {
      throw Error("Execution builder disabled");
    }

    if (skipHeadChecksAndUpdate !== true) {
      notWhileSyncing();
      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      // Process the queued attestations in the forkchoice for correct head estimation
      // forkChoice.updateTime() might have already been called by the onSlot clock
      // handler, in which case this should just return.
      chain.forkChoice.updateTime(slot);
      chain.recomputeForkChoiceHead();
    }

    let timer;
    try {
      timer = metrics?.blockProductionTime.startTimer();
      const {block, executionPayloadValue, consensusBlockValue} = await chain.produceBlindedBlock({
        slot,
        randaoReveal,
        graffiti: toGraffitiBuffer(graffiti || ""),
      });

      metrics?.blockProductionSuccess.inc({source});
      metrics?.blockProductionNumAggregated.observe({source}, block.body.attestations.length);
      logger.verbose("Produced blinded block", {
        slot,
        executionPayloadValue,
        consensusBlockValue,
        root: toHexString(config.getBlindedForkTypes(slot).BeaconBlock.hashTreeRoot(block)),
      });

      if (chain.opts.persistProducedBlocks) {
        void chain.persistBlock(block, "produced_builder_block");
      }

      return {data: block, version, executionPayloadValue, consensusBlockValue};
    } finally {
      if (timer) timer({source});
    }
  };

  const produceEngineFullBlockOrContents = async function produceEngineFullBlockOrContents(
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string,
    {
      feeRecipient,
      strictFeeRecipientCheck,
      skipHeadChecksAndUpdate,
    }: Omit<routes.validator.ExtraProduceBlockOps, "builderSelection"> & {skipHeadChecksAndUpdate?: boolean} = {}
  ): Promise<routes.validator.ProduceBlockOrContentsRes> {
    const source = ProducedBlockSource.engine;
    metrics?.blockProductionRequests.inc({source});

    if (skipHeadChecksAndUpdate !== true) {
      notWhileSyncing();
      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      // Process the queued attestations in the forkchoice for correct head estimation
      // forkChoice.updateTime() might have already been called by the onSlot clock
      // handler, in which case this should just return.
      chain.forkChoice.updateTime(slot);
      chain.recomputeForkChoiceHead();
    }

    let timer;
    try {
      timer = metrics?.blockProductionTime.startTimer();
      const {block, executionPayloadValue, consensusBlockValue} = await chain.produceBlock({
        slot,
        randaoReveal,
        graffiti: toGraffitiBuffer(graffiti || ""),
        feeRecipient,
      });
      const version = config.getForkName(block.slot);
      if (strictFeeRecipientCheck && feeRecipient && isForkExecution(version)) {
        const blockFeeRecipient = toHexString((block as bellatrix.BeaconBlock).body.executionPayload.feeRecipient);
        if (blockFeeRecipient !== feeRecipient) {
          throw Error(`Invalid feeRecipient set in engine block expected=${feeRecipient} actual=${blockFeeRecipient}`);
        }
      }

      metrics?.blockProductionSuccess.inc({source});
      metrics?.blockProductionNumAggregated.observe({source}, block.body.attestations.length);
      logger.verbose("Produced execution block", {
        slot,
        executionPayloadValue,
        consensusBlockValue,
        root: toHexString(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block)),
      });
      if (chain.opts.persistProducedBlocks) {
        void chain.persistBlock(block, "produced_engine_block");
      }
      if (isForkBlobs(version)) {
        const blockHash = toHex((block as bellatrix.BeaconBlock).body.executionPayload.blockHash);
        const contents = chain.producedContentsCache.get(blockHash);
        if (contents === undefined) {
          throw Error("contents missing in cache");
        }

        return {
          data: {block, ...contents} as allForks.BlockContents,
          version,
          executionPayloadValue,
          consensusBlockValue,
        };
      } else {
        return {data: block, version, executionPayloadValue, consensusBlockValue};
      }
    } finally {
      if (timer) timer({source});
    }
  };

  const produceEngineOrBuilderBlock: ServerApi<routes.validator.Api>["produceBlockV3"] =
    async function produceEngineOrBuilderBlock(
      slot,
      randaoReveal,
      graffiti,
      // TODO deneb: skip randao verification
      _skipRandaoVerification?: boolean,
      {
        feeRecipient,
        builderSelection,
        builderBoostFactor,
        strictFeeRecipientCheck,
      }: routes.validator.ExtraProduceBlockOps = {}
    ) {
      notWhileSyncing();
      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      // Process the queued attestations in the forkchoice for correct head estimation
      // forkChoice.updateTime() might have already been called by the onSlot clock
      // handler, in which case this should just return.
      chain.forkChoice.updateTime(slot);
      chain.recomputeForkChoiceHead();

      const fork = config.getForkName(slot);
      // set some sensible opts
      // builderSelection will be deprecated and will run in mode MaxProfit if builder is enabled
      // and the actual selection will be determined using builderBoostFactor passed by the validator
      builderSelection = builderSelection ?? routes.validator.BuilderSelection.MaxProfit;
      builderBoostFactor = builderBoostFactor ?? 100;
      const isBuilderEnabled =
        ForkSeq[fork] >= ForkSeq.bellatrix &&
        chain.executionBuilder !== undefined &&
        builderSelection !== routes.validator.BuilderSelection.ExecutionOnly;

      logger.verbose("Assembling block with produceEngineOrBuilderBlock ", {
        fork,
        builderSelection,
        slot,
        isBuilderEnabled,
        strictFeeRecipientCheck,
        builderBoostFactor,
      });
      // Start calls for building execution and builder blocks
      const blindedBlockPromise = isBuilderEnabled
        ? // can't do fee recipient checks as builder bid doesn't return feeRecipient as of now
          produceBuilderBlindedBlock(slot, randaoReveal, graffiti, {
            feeRecipient,
            // skip checking and recomputing head in these individual produce calls
            skipHeadChecksAndUpdate: true,
          }).catch((e) => {
            logger.error("produceBuilderBlindedBlock failed to produce block", {slot}, e);
            return null;
          })
        : null;

      const fullBlockPromise =
        // At any point either the builder or execution or both flows should be active.
        //
        // Ideally such a scenario should be prevented on startup, but proposerSettingsFile or keymanager
        // configurations could cause a validator pubkey to have builder disabled with builder selection builder only
        // (TODO: independently make sure such an options update is not successful for a validator pubkey)
        //
        // So if builder is disabled ignore builder selection of builderonly if caused by user mistake
        !isBuilderEnabled || builderSelection !== routes.validator.BuilderSelection.BuilderOnly
          ? // TODO deneb: builderSelection needs to be figured out if to be done beacon side
            // || builderSelection !== BuilderSelection.BuilderOnly
            produceEngineFullBlockOrContents(slot, randaoReveal, graffiti, {
              feeRecipient,
              strictFeeRecipientCheck,
              // skip checking and recomputing head in these individual produce calls
              skipHeadChecksAndUpdate: true,
            }).catch((e) => {
              logger.error("produceEngineFullBlockOrContents failed to produce block", {slot}, e);
              return null;
            })
          : null;

      let blindedBlock, fullBlock;
      if (blindedBlockPromise !== null && fullBlockPromise !== null) {
        // reference index of promises in the race
        const promisesOrder = [ProducedBlockSource.builder, ProducedBlockSource.engine];
        [blindedBlock, fullBlock] = await racePromisesWithCutoff<
          routes.validator.ProduceBlockOrContentsRes | routes.validator.ProduceBlindedBlockRes | null
        >(
          [blindedBlockPromise, fullBlockPromise],
          BLOCK_PRODUCTION_RACE_CUTOFF_MS,
          BLOCK_PRODUCTION_RACE_TIMEOUT_MS,
          // Callback to log the race events for better debugging capability
          (event: RaceEvent, delayMs: number, index?: number) => {
            const eventRef = index !== undefined ? {source: promisesOrder[index]} : {};
            logger.verbose("Block production race (builder vs execution)", {
              event,
              ...eventRef,
              delayMs,
              cutoffMs: BLOCK_PRODUCTION_RACE_CUTOFF_MS,
              timeoutMs: BLOCK_PRODUCTION_RACE_TIMEOUT_MS,
              slot,
            });
          }
        );
        if (blindedBlock instanceof Error) {
          // error here means race cutoff exceeded
          logger.error("Failed to produce builder block", {slot}, blindedBlock);
          blindedBlock = null;
        }
        if (fullBlock instanceof Error) {
          logger.error("Failed to produce execution block", {slot}, fullBlock);
          fullBlock = null;
        }
      } else if (blindedBlockPromise !== null && fullBlockPromise === null) {
        blindedBlock = await blindedBlockPromise;
        fullBlock = null;
      } else if (blindedBlockPromise === null && fullBlockPromise !== null) {
        blindedBlock = null;
        fullBlock = await fullBlockPromise;
      } else {
        throw Error(
          `Internal Error: Neither builder nor execution proposal flow activated isBuilderEnabled=${isBuilderEnabled} builderSelection=${builderSelection}`
        );
      }

      const builderPayloadValue = blindedBlock?.executionPayloadValue ?? BigInt(0);
      const enginePayloadValue = fullBlock?.executionPayloadValue ?? BigInt(0);
      const consensusBlockValueBuilder = blindedBlock?.consensusBlockValue ?? BigInt(0);
      const consensusBlockValueEngine = fullBlock?.consensusBlockValue ?? BigInt(0);

      const blockValueBuilder = builderPayloadValue + gweiToWei(consensusBlockValueBuilder); // Total block value is in wei
      const blockValueEngine = enginePayloadValue + gweiToWei(consensusBlockValueEngine); // Total block value is in wei

      let executionPayloadSource: ProducedBlockSource | null = null;

      if (fullBlock && blindedBlock) {
        switch (builderSelection) {
          case routes.validator.BuilderSelection.MaxProfit: {
            if (blockValueEngine >= (blockValueBuilder * BigInt(builderBoostFactor)) / BigInt(100)) {
              executionPayloadSource = ProducedBlockSource.engine;
            } else {
              executionPayloadSource = ProducedBlockSource.builder;
            }
            break;
          }

          case routes.validator.BuilderSelection.ExecutionOnly: {
            executionPayloadSource = ProducedBlockSource.engine;
            break;
          }

          // For everything else just select the builder
          default: {
            executionPayloadSource = ProducedBlockSource.builder;
          }
        }
        logger.verbose(`Selected executionPayloadSource=${executionPayloadSource} block`, {
          builderSelection,
          builderBoostFactor,
          // winston logger doesn't like bigint
          enginePayloadValue: `${enginePayloadValue}`,
          builderPayloadValue: `${builderPayloadValue}`,
          consensusBlockValueEngine: `${consensusBlockValueEngine}`,
          consensusBlockValueBuilder: `${consensusBlockValueBuilder}`,
          blockValueEngine: `${blockValueEngine}`,
          blockValueBuilder: `${blockValueBuilder}`,
          slot,
        });
      } else if (fullBlock && !blindedBlock) {
        executionPayloadSource = ProducedBlockSource.engine;
        logger.verbose("Selected engine block: no builder block produced", {
          // winston logger doesn't like bigint
          enginePayloadValue: `${enginePayloadValue}`,
          consensusBlockValueEngine: `${consensusBlockValueEngine}`,
          blockValueEngine: `${blockValueEngine}`,
          slot,
        });
      } else if (blindedBlock && !fullBlock) {
        executionPayloadSource = ProducedBlockSource.builder;
        logger.verbose("Selected builder block: no engine block produced", {
          // winston logger doesn't like bigint
          builderPayloadValue: `${builderPayloadValue}`,
          consensusBlockValueBuilder: `${consensusBlockValueBuilder}`,
          blockValueBuilder: `${blockValueBuilder}`,
          slot,
        });
      }

      if (executionPayloadSource === null) {
        throw Error(`Failed to produce engine or builder block for slot=${slot}`);
      }

      if (executionPayloadSource === ProducedBlockSource.engine) {
        return {
          ...fullBlock,
          executionPayloadBlinded: false,
          executionPayloadSource,
        } as routes.validator.ProduceBlockOrContentsRes & {
          executionPayloadBlinded: false;
          executionPayloadSource: ProducedBlockSource;
        };
      } else {
        return {
          ...blindedBlock,
          executionPayloadBlinded: true,
          executionPayloadSource,
        } as routes.validator.ProduceBlindedBlockRes & {
          executionPayloadBlinded: true;
          executionPayloadSource: ProducedBlockSource;
        };
      }
    };

  const produceBlock: ServerApi<routes.validator.Api>["produceBlock"] = async function produceBlock(
    slot,
    randaoReveal,
    graffiti
  ) {
    const producedData = await produceEngineFullBlockOrContents(slot, randaoReveal, graffiti);
    if (isForkBlobs(producedData.version)) {
      throw Error(`Invalid call to produceBlock for deneb+ fork=${producedData.version}`);
    } else {
      // TODO: need to figure out why typescript requires typecasting here
      // by typing of produceFullBlockOrContents respose it should have figured this out itself
      return producedData as {data: allForks.BeaconBlock};
    }
  };

  const produceEngineOrBuilderBlindedBlock: ServerApi<routes.validator.Api>["produceBlindedBlock"] =
    async function produceEngineOrBuilderBlindedBlock(slot, randaoReveal, graffiti) {
      const {data, executionPayloadValue, consensusBlockValue, version} = await produceEngineOrBuilderBlock(
        slot,
        randaoReveal,
        graffiti
      );
      if (!isForkExecution(version)) {
        throw Error(`Invalid fork=${version} for produceEngineOrBuilderBlindedBlock`);
      }
      const executionPayloadBlinded = true;

      if (isBlockContents(data)) {
        const {block} = data;
        const blindedBlock = beaconBlockToBlinded(config, block as allForks.AllForksExecution["BeaconBlock"]);
        return {executionPayloadValue, consensusBlockValue, data: blindedBlock, executionPayloadBlinded, version};
      } else if (isBlindedBeaconBlock(data)) {
        return {executionPayloadValue, consensusBlockValue, data, executionPayloadBlinded, version};
      } else {
        const blindedBlock = beaconBlockToBlinded(config, data as allForks.AllForksExecution["BeaconBlock"]);
        return {executionPayloadValue, consensusBlockValue, data: blindedBlock, executionPayloadBlinded, version};
      }
    };

  const produceBlockV3: ServerApi<routes.validator.Api>["produceBlockV3"] = async function produceBlockV3(
    slot,
    randaoReveal,
    graffiti,
    skipRandaoVerification?: boolean,
    opts: routes.validator.ExtraProduceBlockOps = {}
  ) {
    const produceBlockEngineOrBuilderRes = await produceEngineOrBuilderBlock(
      slot,
      randaoReveal,
      graffiti,
      skipRandaoVerification,
      opts
    );

    if (opts.blindedLocal === true && ForkSeq[produceBlockEngineOrBuilderRes.version] >= ForkSeq.bellatrix) {
      if (produceBlockEngineOrBuilderRes.executionPayloadBlinded) {
        return produceBlockEngineOrBuilderRes;
      } else {
        if (isBlockContents(produceBlockEngineOrBuilderRes.data)) {
          const {block} = produceBlockEngineOrBuilderRes.data;
          const blindedBlock = beaconBlockToBlinded(config, block as allForks.AllForksExecution["BeaconBlock"]);
          return {
            ...produceBlockEngineOrBuilderRes,
            data: blindedBlock,
            executionPayloadBlinded: true,
          } as routes.validator.ProduceBlindedBlockRes & {
            executionPayloadBlinded: true;
            executionPayloadSource: ProducedBlockSource;
          };
        } else {
          const blindedBlock = beaconBlockToBlinded(
            config,
            produceBlockEngineOrBuilderRes.data as allForks.AllForksExecution["BeaconBlock"]
          );
          return {
            ...produceBlockEngineOrBuilderRes,
            data: blindedBlock,
            executionPayloadBlinded: true,
          } as routes.validator.ProduceBlindedBlockRes & {
            executionPayloadBlinded: true;
            executionPayloadSource: ProducedBlockSource;
          };
        }
      }
    } else {
      return produceBlockEngineOrBuilderRes;
    }
  };

  return {
    produceBlock,
    produceBlockV2: produceEngineFullBlockOrContents,
    produceBlockV3,
    produceBlindedBlock: produceEngineOrBuilderBlindedBlock,

    async produceAttestationData(committeeIndex, slot) {
      notWhileSyncing();

      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      // This needs a state in the same epoch as `slot` such that state.currentJustifiedCheckpoint is correct.
      // Note: This may trigger an epoch transition if there skipped slots at the beginning of the epoch.
      const headState = chain.getHeadState();
      const headSlot = headState.slot;
      const attEpoch = computeEpochAtSlot(slot);
      const headBlockRootHex = chain.forkChoice.getHead().blockRoot;
      const headBlockRoot = fromHexString(headBlockRootHex);

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

      // To get the correct source we must get a state in the same epoch as the attestation's epoch.
      // An epoch transition may change state.currentJustifiedCheckpoint
      const attEpochState = await chain.getHeadStateAtEpoch(attEpoch, RegenCaller.produceAttestationData);

      return {
        data: {
          slot,
          index: committeeIndex,
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
    async produceSyncCommitteeContribution(slot, subcommitteeIndex, beaconBlockRoot) {
      // when a validator is configured with multiple beacon node urls, this beaconBlockRoot may come from another beacon node
      // and it hasn't been in our forkchoice since we haven't seen / processing that block
      // see https://github.com/ChainSafe/lodestar/issues/5063
      if (!chain.forkChoice.hasBlock(beaconBlockRoot)) {
        const rootHex = toHexString(beaconBlockRoot);
        network.searchUnknownSlotRoot({slot, root: rootHex});
        // if result of this call is false, i.e. block hasn't seen after 1 slot then the below notOnOptimisticBlockRoot call will throw error
        await chain.waitForBlock(slot, rootHex);
      }

      // Check the execution status as validator shouldn't contribute on an optimistic head
      notOnOptimisticBlockRoot(beaconBlockRoot);

      const contribution = chain.syncCommitteeMessagePool.getContribution(subcommitteeIndex, slot, beaconBlockRoot);
      if (!contribution) throw new ApiError(500, "No contribution available");

      metrics?.production.producedSyncContributionParticipants.observe(
        contribution.aggregationBits.getTrueBitIndexes().length
      );

      return {data: contribution};
    },

    async getProposerDuties(epoch) {
      notWhileSyncing();

      // Early check that epoch is within [current_epoch, current_epoch + 1], or allow for pre-genesis
      const currentEpoch = currentEpochWithDisparity();
      const nextEpoch = currentEpoch + 1;
      if (currentEpoch >= 0 && epoch !== currentEpoch && epoch !== nextEpoch) {
        throw Error(`Requested epoch ${epoch} must equal current ${currentEpoch} or next epoch ${nextEpoch}`);
      }

      const head = chain.forkChoice.getHead();
      let state: CachedBeaconStateAllForks | undefined = undefined;
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
        state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.getDuties);
      }

      const stateEpoch = state.epochCtx.epoch;
      let indexes: ValidatorIndex[] = [];

      if (epoch === stateEpoch) {
        indexes = state.epochCtx.getBeaconProposers();
      } else if (epoch === stateEpoch + 1) {
        // Requesting duties for next epoch is allow since they can be predicted with high probabilities.
        // @see `epochCtx.getBeaconProposersNextEpoch` JSDocs for rationale.
        indexes = state.epochCtx.getBeaconProposersNextEpoch();
      } else {
        // Should never happen, epoch is checked to be in bounds above
        throw Error(`Proposer duties for epoch ${epoch} not supported, current epoch ${stateEpoch}`);
      }

      // NOTE: this is the fastest way of getting compressed pubkeys.
      //       See benchmark -> packages/lodestar/test/perf/api/impl/validator/attester.test.ts
      // After dropping the flat caches attached to the CachedBeaconState it's no longer available.
      // TODO: Add a flag to just send 0x00 as pubkeys since the Lodestar validator does not need them.
      const pubkeys = getPubkeysForIndices(state.validators, indexes);

      const startSlot = computeStartSlotAtEpoch(stateEpoch);
      const duties: routes.validator.ProposerDuty[] = [];
      for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
        duties.push({slot: startSlot + i, validatorIndex: indexes[i], pubkey: pubkeys[i]});
      }

      // Returns `null` on the one-off scenario where the genesis block decides its own shuffling.
      // It should be set to the latest block applied to `self` or the genesis block root.
      const dependentRoot = proposerShufflingDecisionRoot(state) || (await getGenesisBlockRoot(state));

      return {
        data: duties,
        dependentRoot: toHex(dependentRoot),
        executionOptimistic: isOptimisticBlock(head),
      };
    },

    async getAttesterDuties(epoch, validatorIndices) {
      notWhileSyncing();

      if (validatorIndices.length === 0) {
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
      const pubkeys = getPubkeysForIndices(state.validators, validatorIndices);
      const committeeAssignments = state.epochCtx.getCommitteeAssignments(epoch, validatorIndices);
      const duties: routes.validator.AttesterDuty[] = [];
      for (let i = 0, len = validatorIndices.length; i < len; i++) {
        const validatorIndex = validatorIndices[i];
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
        dependentRoot: toHex(dependentRoot),
        executionOptimistic: isOptimisticBlock(head),
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
    async getSyncCommitteeDuties(epoch, validatorIndices) {
      notWhileSyncing();

      if (validatorIndices.length === 0) {
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
      const pubkeys = getPubkeysForIndices(state.validators, validatorIndices);
      // Ensures `epoch // EPOCHS_PER_SYNC_COMMITTEE_PERIOD <= current_epoch // EPOCHS_PER_SYNC_COMMITTEE_PERIOD + 1`
      const syncCommitteeCache = state.epochCtx.getIndexedSyncCommitteeAtEpoch(epoch);
      const syncCommitteeValidatorIndexMap = syncCommitteeCache.validatorIndexMap;

      const duties: routes.validator.SyncDuty[] = [];
      for (let i = 0, len = validatorIndices.length; i < len; i++) {
        const validatorIndex = validatorIndices[i];
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
        executionOptimistic: isOptimisticBlock(head),
      };
    },

    async getAggregatedAttestation(attestationDataRoot, slot) {
      notWhileSyncing();

      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      const aggregate = chain.attestationPool.getAggregate(slot, attestationDataRoot);
      metrics?.production.producedAggregateParticipants.observe(aggregate.aggregationBits.getTrueBitIndexes().length);

      return {
        data: aggregate,
      };
    },

    async publishAggregateAndProofs(signedAggregateAndProofs) {
      notWhileSyncing();

      const seenTimestampSec = Date.now() / 1000;
      const errors: Error[] = [];
      const fork = chain.config.getForkName(chain.clock.currentSlot);

      await Promise.all(
        signedAggregateAndProofs.map(async (signedAggregateAndProof, i) => {
          try {
            // TODO: Validate in batch
            // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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

            chain.aggregatedAttestationPool.add(
              signedAggregateAndProof.message.aggregate,
              attDataRootHex,
              indexedAttestation.attestingIndices.length,
              committeeIndices
            );
            const sentPeers = await network.publishBeaconAggregateAndProof(signedAggregateAndProof);
            metrics?.onPoolSubmitAggregatedAttestation(seenTimestampSec, indexedAttestation, sentPeers);
          } catch (e) {
            if (e instanceof AttestationError && e.type.code === AttestationErrorCode.AGGREGATOR_ALREADY_KNOWN) {
              logger.debug("Ignoring known signedAggregateAndProof");
              return; // Ok to submit the same aggregate twice
            }

            errors.push(e as Error);
            logger.error(
              `Error on publishAggregateAndProofs [${i}]`,
              {
                slot: signedAggregateAndProof.message.aggregate.data.slot,
                index: signedAggregateAndProof.message.aggregate.data.index,
              },
              e as Error
            );
            if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
              chain.persistInvalidSszValue(ssz.phase0.SignedAggregateAndProof, signedAggregateAndProof, "api_reject");
            }
          }
        })
      );

      if (errors.length > 1) {
        throw Error("Multiple errors on publishAggregateAndProofs\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
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
    async publishContributionAndProofs(contributionAndProofs) {
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
            errors.push(e as Error);
            logger.error(
              `Error on publishContributionAndProofs [${i}]`,
              {
                slot: contributionAndProof.message.contribution.slot,
                subcommitteeIndex: contributionAndProof.message.contribution.subcommitteeIndex,
              },
              e as Error
            );
            if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
              chain.persistInvalidSszValue(ssz.altair.SignedContributionAndProof, contributionAndProof, "api_reject");
            }
          }
        })
      );

      if (errors.length > 1) {
        throw Error("Multiple errors on publishContributionAndProofs\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
        throw errors[0];
      }
    },

    async prepareBeaconCommitteeSubnet(subscriptions) {
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
          metrics.registerLocalValidator(subscription.validatorIndex);
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
    async prepareSyncCommitteeSubnets(subscriptions) {
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
          metrics.registerLocalValidatorInSyncCommittee(subscription.validatorIndex, subscription.untilEpoch);
        }
      }
    },

    async prepareBeaconProposer(proposers) {
      await chain.updateBeaconProposerData(chain.clock.currentEpoch, proposers);
    },

    async submitBeaconCommitteeSelections() {
      throw new OnlySupportedByDVT();
    },

    async submitSyncCommitteeSelections() {
      throw new OnlySupportedByDVT();
    },

    async getLiveness(epoch, validatorIndices) {
      if (validatorIndices.length === 0) {
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
        data: validatorIndices.map((index) => ({
          index,
          isLive: chain.validatorSeenAtEpoch(index, epoch),
        })),
      };
    },

    async registerValidator(registrations) {
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
        if (validatorIndex === undefined) return false;

        const validator = headState.validators.getReadonly(validatorIndex);
        const status = getValidatorStatus(validator, currentEpoch);
        return (
          status === "active" ||
          status === "active_exiting" ||
          status === "active_ongoing" ||
          status === "active_slashed" ||
          status === "pending_initialized" ||
          status === "pending_queued"
        );
      });

      await chain.executionBuilder.registerValidator(filteredRegistrations);

      logger.debug("Forwarded validator registrations to connected builder", {
        epoch: currentEpoch,
        count: filteredRegistrations.length,
      });
    },
  };
}
