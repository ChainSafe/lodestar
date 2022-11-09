import {BLSPubkey, Slot, BLSSignature, allForks, bellatrix, isBlindedBeaconBlock} from "@lodestar/types";
import {IChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {extendError, prettyBytes} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";
import {Api} from "@lodestar/api";
import {IClock, ILoggerVc} from "../util/index.js";
import {PubkeyHex} from "../types.js";
import {Metrics} from "../metrics.js";
import {ValidatorStore} from "./validatorStore.js";
import {BlockDutiesService, GENESIS_SLOT} from "./blockDuties.js";

/**
 * Service that sets up and handles validator block proposal duties.
 */
export class BlockProposingService {
  private readonly dutiesService: BlockDutiesService;

  constructor(
    private readonly config: IChainForkConfig,
    private readonly logger: ILoggerVc,
    private readonly api: Api,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly metrics: Metrics | null
  ) {
    this.dutiesService = new BlockDutiesService(
      logger,
      api,
      clock,
      validatorStore,
      metrics,
      this.notifyBlockProductionFn
    );
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    this.dutiesService.removeDutiesForKey(pubkey);
  }

  /**
   * `BlockDutiesService` must call this fn to trigger block creation
   * This function may run more than once at a time, rationale in `BlockDutiesService.pollBeaconProposers`
   */
  private notifyBlockProductionFn = (slot: Slot, proposers: BLSPubkey[]): void => {
    if (slot <= GENESIS_SLOT) {
      this.logger.debug("Not producing block before or at genesis slot");
      return;
    }

    if (proposers.length > 1) {
      this.logger.warn("Multiple block proposers", {slot, count: proposers.length});
    }

    Promise.all(proposers.map((pubkey) => this.createAndPublishBlock(pubkey, slot))).catch((e: Error) => {
      this.logger.error("Error on block duties", {slot}, e);
    });
  };

  /** Produce a block at the given slot for pubkey */
  private async createAndPublishBlock(pubkey: BLSPubkey, slot: Slot): Promise<void> {
    const pubkeyHex = toHexString(pubkey);
    const logCtx = {slot, validator: prettyBytes(pubkeyHex)};

    // Wrap with try catch here to re-use `logCtx`
    try {
      const randaoReveal = await this.validatorStore.signRandao(pubkey, slot);
      const graffiti = this.validatorStore.getGraffiti(pubkeyHex);

      const debugLogCtx = {...logCtx, validator: pubkeyHex};

      this.logger.debug("Producing block", debugLogCtx);
      this.metrics?.proposerStepCallProduceBlock.observe(this.clock.secFromSlot(slot));

      const strictFeeRecipientCheck = this.validatorStore.strictFeeRecipientCheck(pubkeyHex);
      const isBuilderEnabled = this.validatorStore.isBuilderEnabled(pubkeyHex);
      const expectedFeeRecipient = this.validatorStore.getFeeRecipient(pubkeyHex);

      const block = await this.produceBlockWrapper(slot, randaoReveal, graffiti, {
        expectedFeeRecipient,
        strictFeeRecipientCheck,
        isBuilderEnabled,
      }).catch((e: Error) => {
        this.metrics?.blockProposingErrors.inc({error: "produce"});
        throw extendError(e, "Failed to produce block");
      });

      this.logger.debug("Produced block", {...debugLogCtx, ...block.debugLogCtx});
      this.metrics?.blocksProduced.inc();

      const signedBlock = await this.validatorStore.signBlock(pubkey, block.data, slot);

      this.metrics?.proposerStepCallPublishBlock.observe(this.clock.secFromSlot(slot));

      await this.publishBlockWrapper(signedBlock).catch((e: Error) => {
        this.metrics?.blockProposingErrors.inc({error: "publish"});
        throw extendError(e, "Failed to publish block");
      });
      this.logger.info("Published block", {...logCtx, graffiti, ...block.debugLogCtx});
      this.metrics?.blocksPublished.inc();
    } catch (e) {
      this.logger.error("Error proposing block", logCtx, e as Error);
    }
  }

  private publishBlockWrapper = async (signedBlock: allForks.FullOrBlindedSignedBeaconBlock): Promise<void> => {
    return isBlindedBeaconBlock(signedBlock.message)
      ? this.api.beacon.publishBlindedBlock(signedBlock as bellatrix.SignedBlindedBeaconBlock)
      : this.api.beacon.publishBlock(signedBlock as allForks.SignedBeaconBlock);
  };

  private produceBlockWrapper = async (
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string,
    {
      expectedFeeRecipient,
      strictFeeRecipientCheck,
      isBuilderEnabled,
    }: {expectedFeeRecipient: string; strictFeeRecipientCheck: boolean; isBuilderEnabled: boolean}
  ): Promise<{data: allForks.FullOrBlindedBeaconBlock} & {debugLogCtx: Record<string, string>}> => {
    const blindedBlockPromise = isBuilderEnabled
      ? this.api.validator.produceBlindedBlock(slot, randaoReveal, graffiti).catch((e: Error) => {
          this.logger.error("Failed to produce builder block", {}, e as Error);
          return null;
        })
      : null;

    const fullBlockPromise = this.produceBlock(slot, randaoReveal, graffiti).catch((e: Error) => {
      this.logger.error("Failed to produce builder block", {}, e as Error);
      return null;
    });

    await Promise.all([blindedBlockPromise, fullBlockPromise]);

    const blindedBlock = await blindedBlockPromise;
    const fullBlock = await fullBlockPromise;

    // A metric on the choice between blindedBlock and normal block can be applied
    if (blindedBlock) {
      const debugLogCtx = {source: "builder"};
      return {...blindedBlock, debugLogCtx};
    } else {
      const debugLogCtx = {source: "engine"};
      if (!fullBlock) {
        throw Error("Failed to produce engine or builder block");
      }
      const blockFeeRecipient = (fullBlock.data as bellatrix.BeaconBlock).body.executionPayload?.feeRecipient;
      const feeRecipient = blockFeeRecipient !== undefined ? toHexString(blockFeeRecipient) : undefined;
      if (feeRecipient !== undefined) {
        // In Mev Builder, the feeRecipient could differ and rewards to the feeRecipeint
        // might be included in the block transactions as indicated by the BuilderBid
        // Address this appropriately in the Mev boost PR
        //
        // Even for engine, there could be divergence of feeRecipient the argument being
        // that the bn <> engine setup has implied trust and are user-agents of the same entity.
        // A better approach would be to have engine also provide something akin to BuilderBid
        //
        // The following conversation in the interop R&D channel can provide some context
        // https://discord.com/channels/595666850260713488/892088344438255616/978374892678426695
        //
        // For now providing a strick check flag to enable disable this
        if (feeRecipient !== expectedFeeRecipient && strictFeeRecipientCheck) {
          throw Error(`Invalid feeRecipient=${feeRecipient}, expected=${expectedFeeRecipient}`);
        }
        Object.assign(debugLogCtx, {feeRecipient});
      }
      return {...fullBlock, debugLogCtx};
      // throw Error("random")
    }
  };

  /** Wrapper around the API's different methods for producing blocks across forks */
  private produceBlock: Api["validator"]["produceBlock"] = async (
    slot,
    randaoReveal,
    graffiti
  ): Promise<{data: allForks.BeaconBlock}> => {
    switch (this.config.getForkName(slot)) {
      case ForkName.phase0:
        return this.api.validator.produceBlock(slot, randaoReveal, graffiti);
      // All subsequent forks are expected to use v2 too
      case ForkName.altair:
      default:
        return this.api.validator.produceBlockV2(slot, randaoReveal, graffiti);
    }
  };
}
