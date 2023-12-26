import {ServerApi, routes} from "@lodestar/api";
import {ForkSeq, isForkExecution} from "@lodestar/params";
import {BLSSignature, ProducedBlockSource, Slot} from "@lodestar/types";
import {toHexString, resolveOrRacePromises} from "@lodestar/utils";
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
  ) {
    const {notWhileSyncing, waitForSlotWithDisparity} = deps;
    const {chain, config, logger} = modules;

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

    // At any point either the builder or execution or both flows should be active.
    //
    // Ideally such a scenario should be prevented on startup, but proposerSettingsFile or keymanager
    // configurations could cause a validator pubkey to have builder disabled with builder selection builder only
    // (TODO: independently make sure such an options update is not successful for a validator pubkey)
    if (isBuilderEnabled && builderSelection === routes.validator.BuilderSelection.BuilderOnly) {
      return builderOnlyFlow(modules, deps, {feeRecipient, graffiti, randaoReveal, slot});
    }

    // If builder is disabled ignore builder selection of builder only if caused by user mistake
    if (!isBuilderEnabled) {
      return engineOnlyFlow(modules, deps, {
        feeRecipient,
        graffiti,
        randaoReveal,
        slot,
        strictFeeRecipientCheck,
      });
    }

    return builderAndExecutionFlow(modules, deps, {
      feeRecipient,
      graffiti,
      randaoReveal,
      slot,
      strictFeeRecipientCheck,
      builderSelection,
    });
  };
}

async function produceBlindedBlockOrContents(
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

export async function engineOnlyFlow(
  {logger}: ApiModules,
  {produceBlockV2}: ValidatorEndpointDependencies & {produceBlockV2: ServerApi<routes.validator.Api>["produceBlockV2"]},
  {
    feeRecipient,
    slot,
    randaoReveal,
    graffiti,
    strictFeeRecipientCheck,
  }: routes.validator.ExtraProduceBlockOps & {
    slot: Slot;
    randaoReveal: BLSSignature;
    graffiti: string;
    strictFeeRecipientCheck?: boolean;
  }
): Promise<
  routes.validator.ProduceBlockOrContentsRes & {
    executionPayloadBlinded: false;
  }
> {
  const startTime = Date.now();
  logger.verbose("Block production via engine only starting", {
    slot,
  });

  try {
    const block = await produceBlockV2(slot, randaoReveal, graffiti, {
      feeRecipient,
      strictFeeRecipientCheck,
      // skip checking and recomputing head in these individual produce calls
      skipHeadChecksAndUpdate: true,
    });
    logger.verbose("Engine produced the block", {slot, durationMs: Date.now() - startTime});

    return {...block, executionPayloadBlinded: false};
  } catch (err) {
    logger.error("Engine failed to produce the block", {
      durationMs: Date.now() - startTime,
      slot,
    });
    throw err;
  }
}

export async function builderOnlyFlow(
  modules: ApiModules,
  deps: ValidatorEndpointDependencies,
  {
    feeRecipient,
    slot,
    randaoReveal,
    graffiti,
  }: routes.validator.ExtraProduceBlockOps & {
    slot: Slot;
    randaoReveal: BLSSignature;
    graffiti: string;
  }
): Promise<
  routes.validator.ProduceBlindedBlockRes & {
    executionPayloadBlinded: true;
  }
> {
  const {logger} = modules;

  const startTime = Date.now();
  logger.verbose("Block production via builder only starting", {
    slot,
  });

  try {
    const block = await produceBlindedBlockOrContents(modules, deps, {
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      // skip checking and recomputing head in these individual produce calls
      skipHeadChecksAndUpdate: true,
    });
    logger.verbose("Builder produced the block", {slot, durationMs: Date.now() - startTime});

    return {...block, executionPayloadBlinded: true};
  } catch (err) {
    logger.error("Builder failed to produce the block", {
      durationMs: Date.now() - startTime,
      slot,
    });
    throw err;
  }
}

async function builderAndExecutionFlow(
  modules: ApiModules,
  deps: ValidatorEndpointDependencies & {produceBlockV2: ServerApi<routes.validator.Api>["produceBlockV2"]},
  {
    feeRecipient,
    slot,
    randaoReveal,
    graffiti,
    strictFeeRecipientCheck,
    builderSelection,
  }: routes.validator.ExtraProduceBlockOps & {
    slot: Slot;
    randaoReveal: BLSSignature;
    graffiti: string;
    strictFeeRecipientCheck?: boolean;
  }
): Promise<routes.validator.ProduceFullOrBlindedBlockOrContentsRes> {
  const {logger} = modules;
  const {produceBlockV2} = deps;

  const startTime = Date.now();
  logger.verbose("Block production race (builder vs execution) starting", {
    cutoffMs: BLOCK_PRODUCTION_RACE_CUTOFF_MS,
    timeoutMs: BLOCK_PRODUCTION_RACE_TIMEOUT_MS,
    slot,
  });

  const [builder, engine] = await resolveOrRacePromises(
    [
      produceBlindedBlockOrContents(modules, deps, {
        slot,
        randaoReveal,
        graffiti,
        feeRecipient,
        // skip checking and recomputing head in these individual produce calls
        skipHeadChecksAndUpdate: true,
      }),
      produceBlockV2(slot, randaoReveal, graffiti, {
        feeRecipient,
        strictFeeRecipientCheck,
        // skip checking and recomputing head in these individual produce calls
        skipHeadChecksAndUpdate: true,
      }),
    ],
    {
      resolveTimeoutMs: BLOCK_PRODUCTION_RACE_CUTOFF_MS,
      raceTimeoutMs: BLOCK_PRODUCTION_RACE_TIMEOUT_MS,
    }
  );

  if (builder.status === "rejected") {
    logger.error(
      "Builder failed to produce the block",
      {
        durationMs: Date.now() - startTime,
        slot,
      },
      builder.reason as Error
    );
  }

  if (engine.status === "rejected") {
    logger.error(
      "Execution failed to produce the block",
      {
        durationMs: Date.now() - startTime,
        slot,
      },
      engine.reason as Error
    );
  }

  if (builder.status === "pending" && engine.status === "pending") {
    throw Error(`Builder and execution both timeout to proposed the block in ${BLOCK_PRODUCTION_RACE_TIMEOUT_MS}ms`);
  }

  if (builder.status === "fulfilled" && engine.status === "fulfilled") {
    logger.verbose("Builder and execution both produced the block", {durationMs: Date.now() - startTime, slot});

    builderSelection = builderSelection ?? routes.validator.BuilderSelection.MaxProfit;
    let selectedSource: ProducedBlockSource | null = null;
    const builderBlock = builder.value;
    const engineBlock = engine.value;

    const enginePayloadValue = engineBlock.executionPayloadValue ?? BigInt(0);
    const engineConsensusValue = engineBlock.consensusBlockValue ?? BigInt(0);
    const builderPayloadValue = builderBlock.executionPayloadValue ?? BigInt(0);
    const builderConsensusValue = builderBlock.consensusBlockValue ?? BigInt(0);

    const builderBlockValue = builderPayloadValue + builderConsensusValue;
    const engineBlockValue = enginePayloadValue + engineConsensusValue;

    switch (builderSelection) {
      case routes.validator.BuilderSelection.MaxProfit: {
        if (engineBlockValue >= builderBlockValue) {
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
      engineConsensusValue: `${engineConsensusValue}`,
      builderConsensusValue: `${builderConsensusValue}`,
      engineBlockValue: `${engineBlockValue}`,
      builderBlock: `${builderBlockValue}`,
      slot,
    });

    if (selectedSource === ProducedBlockSource.engine) {
      return {...engineBlock, executionPayloadBlinded: false} as routes.validator.ProduceBlockOrContentsRes & {
        executionPayloadBlinded: false;
      };
    } else {
      return {...builderBlock, executionPayloadBlinded: true};
    }
  }

  if (builder.status === "fulfilled") {
    logger.verbose("Builder won the race", {durationMs: Date.now() - startTime, slot});

    return {...builder.value, executionPayloadBlinded: true};
  }

  if (engine.status === "fulfilled") {
    logger.verbose("Execution won the race", {durationMs: Date.now() - startTime, slot});

    return {...engine.value, executionPayloadBlinded: false} as routes.validator.ProduceBlockOrContentsRes & {
      executionPayloadBlinded: false;
    };
  }

  throw new Error("Error occurred during the builder and execution block production");
}
