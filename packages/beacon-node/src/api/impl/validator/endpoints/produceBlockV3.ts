import {ServerApi, routes} from "@lodestar/api";
import {ForkSeq, isForkExecution} from "@lodestar/params";
import {BLSSignature, ProducedBlockSource, Slot} from "@lodestar/types";
import {RaceEvent, gweiToWei, racePromisesWithCutoff, toHexString} from "@lodestar/utils";
import {ApiModules} from "../../types.js";
import {toGraffitiBuffer} from "../../../../util/graffiti.js";
import {ValidatorEndpointDependencies} from "./types.js";

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

export function buildProduceBlockV3(
  modules: ApiModules,
  deps: ValidatorEndpointDependencies & {produceBlockV2: ServerApi<routes.validator.Api>["produceBlockV2"]}
): ServerApi<routes.validator.Api>["produceBlockV3"] {
  return async function produceBlockV3(
    slot,
    randaoReveal,
    graffiti,
    // TODO deneb: skip randao verification
    _skipRandaoVerification?: boolean,
    {feeRecipient, builderSelection, strictFeeRecipientCheck}: routes.validator.ExtraProduceBlockOps = {}
  ): Promise<routes.validator.ProduceFullOrBlindedBlockOrContentsRes> {
    const {chain, config, logger} = modules;
    const {notWhileSyncing, waitForSlotWithDisparity, produceBlockV2} = deps;
    notWhileSyncing();
    await waitForSlotWithDisparity(slot); // Must never request for a future slot > currentSlot

    // Process the queued attestations in the forkchoice for correct head estimation
    // forkChoice.updateTime() might have already been called by the onSlot clock
    // handler, in which case this should just return.
    chain.forkChoice.updateTime(slot);
    chain.recomputeForkChoiceHead();

    const fork = config.getForkName(slot);
    // set some sensible opts
    builderSelection = builderSelection ?? routes.validator.BuilderSelection.MaxProfit;
    const isBuilderEnabled =
      ForkSeq[fork] >= ForkSeq.bellatrix &&
      chain.executionBuilder !== undefined &&
      builderSelection !== routes.validator.BuilderSelection.ExecutionOnly;

    logger.verbose("Assembling block with produceBlockV3 ", {
      fork,
      builderSelection,
      slot,
      isBuilderEnabled,
      strictFeeRecipientCheck,
    });
    // Start calls for building execution and builder blocks
    const blindedBlockPromise = isBuilderEnabled
      ? // can't do fee recipient checks as builder bid doesn't return feeRecipient as of now
        produceBuilderBlindedBlock(modules, deps, {
          slot,
          randaoReveal,
          graffiti,
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
          produceBlockV2(slot, randaoReveal, graffiti, {
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

    let selectedSource: ProducedBlockSource | null = null;

    if (fullBlock && blindedBlock) {
      switch (builderSelection) {
        case routes.validator.BuilderSelection.MaxProfit: {
          if (blockValueEngine >= blockValueBuilder) {
            selectedSource = ProducedBlockSource.engine;
          } else {
            selectedSource = ProducedBlockSource.builder;
          }
          break;
        }

        case routes.validator.BuilderSelection.ExecutionOnly: {
          selectedSource = ProducedBlockSource.engine;
          break;
        }

        // For everything else just select the builder
        default: {
          selectedSource = ProducedBlockSource.builder;
        }
      }
      logger.verbose(`Selected ${selectedSource} block`, {
        builderSelection,
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
      selectedSource = ProducedBlockSource.engine;
      logger.verbose("Selected engine block: no builder block produced", {
        // winston logger doesn't like bigint
        enginePayloadValue: `${enginePayloadValue}`,
        consensusBlockValueEngine: `${consensusBlockValueEngine}`,
        blockValueEngine: `${blockValueEngine}`,
        slot,
      });
    } else if (blindedBlock && !fullBlock) {
      selectedSource = ProducedBlockSource.builder;
      logger.verbose("Selected builder block: no engine block produced", {
        // winston logger doesn't like bigint
        builderPayloadValue: `${builderPayloadValue}`,
        consensusBlockValueBuilder: `${consensusBlockValueBuilder}`,
        blockValueBuilder: `${blockValueBuilder}`,
        slot,
      });
    }

    if (selectedSource === null) {
      throw Error(`Failed to produce engine or builder block for slot=${slot}`);
    }

    if (selectedSource === ProducedBlockSource.engine) {
      return {...fullBlock, executionPayloadBlinded: false} as routes.validator.ProduceBlockOrContentsRes & {
        executionPayloadBlinded: false;
      };
    } else {
      return {
        ...blindedBlock,
        executionPayloadBlinded: true,
      } as routes.validator.ProduceFullOrBlindedBlockOrContentsRes;
    }
  };
}

async function produceBuilderBlindedBlock(
  {chain, config, logger, metrics}: ApiModules,
  {notWhileSyncing, waitForSlotWithDisparity}: ValidatorEndpointDependencies,
  {
    slot,
    randaoReveal,
    graffiti,
    // as of now fee recipient checks can not be performed because builder does not return bid recipient
    skipHeadChecksAndUpdate,
  }: {
    slot: Slot;
    randaoReveal: BLSSignature;
    graffiti: string;
  } & Omit<routes.validator.ExtraProduceBlockOps, "builderSelection"> & {skipHeadChecksAndUpdate?: boolean}
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
    await waitForSlotWithDisparity(slot); // Must never request for a future slot > currentSlot

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
}
