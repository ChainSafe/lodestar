import {BLSPubkey, Slot, BLSSignature, allForks, bellatrix, capella, isBlindedBeaconBlock, Wei} from "@lodestar/types";
import {IChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {extendError, prettyBytes} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";
import {Api, ApiError, ServerApi} from "@lodestar/api";
import {IClock, ILoggerVc} from "../util/index.js";
import {PubkeyHex} from "../types.js";
import {Metrics} from "../metrics.js";
import {ValidatorStore, BuilderSelection} from "./validatorStore.js";
import {BlockDutiesService, GENESIS_SLOT} from "./blockDuties.js";

const ETH_TO_WEI = BigInt("1000000000000000000");

type ProduceBlockOpts = {
  expectedFeeRecipient: string;
  strictFeeRecipientCheck: boolean;
  isBuilderEnabled: boolean;
  builderSelection: BuilderSelection;
};
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
      const builderSelection = this.validatorStore.getBuilderSelection(pubkeyHex);
      const expectedFeeRecipient = this.validatorStore.getFeeRecipient(pubkeyHex);

      const block = await this.produceBlockWrapper(slot, randaoReveal, graffiti, {
        expectedFeeRecipient,
        strictFeeRecipientCheck,
        isBuilderEnabled,
        builderSelection,
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
    ApiError.assert(
      isBlindedBeaconBlock(signedBlock.message)
        ? await this.api.beacon.publishBlindedBlock(signedBlock as bellatrix.SignedBlindedBeaconBlock)
        : await this.api.beacon.publishBlock(signedBlock as allForks.SignedBeaconBlock)
    );
  };

  private produceBlockWrapper = async (
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string,
    {expectedFeeRecipient, strictFeeRecipientCheck, isBuilderEnabled, builderSelection}: ProduceBlockOpts
  ): Promise<{data: allForks.FullOrBlindedBeaconBlock} & {debugLogCtx: Record<string, string>}> => {
    const blindedBlockPromise = isBuilderEnabled
      ? this.produceBlindedBlock(slot, randaoReveal, graffiti).catch((e: Error) => {
          this.logger.error("Failed to produce builder block", {}, e as Error);
          return null;
        })
      : null;

    const fullBlockPromise = this.produceBlock(slot, randaoReveal, graffiti).catch((e: Error) => {
      this.logger.error("Failed to produce execution block", {}, e as Error);
      return null;
    });

    await Promise.all([blindedBlockPromise, fullBlockPromise]);

    const blindedBlock = await blindedBlockPromise;
    const builderBlockValue = blindedBlock?.blockValue ?? BigInt(0);

    const fullBlock = await fullBlockPromise;
    const engineBlockValue = fullBlock?.blockValue ?? BigInt(0);

    const feeRecipientCheck = {expectedFeeRecipient, strictFeeRecipientCheck};

    if (fullBlock && blindedBlock) {
      let selectedSource: string;
      let selectedBlock;
      switch (builderSelection) {
        case BuilderSelection.MaxProfit: {
          if (engineBlockValue >= builderBlockValue) {
            selectedSource = "engine";
            selectedBlock = fullBlock;
          } else {
            selectedSource = "builder";
            selectedBlock = blindedBlock;
          }
          break;
        }

        case BuilderSelection.BuilderAlways:
        default: {
          selectedSource = "builder";
          selectedBlock = blindedBlock;
        }
      }
      this.logger.debug(`Selected ${selectedSource} block`, {
        builderSelection,
        // winston logger doesn't like bigint
        engineBlockValue: `${engineBlockValue}`,
        builderBlockValue: `${builderBlockValue}`,
      });
      return this.getBlockWithDebugLog(selectedBlock, selectedSource, feeRecipientCheck);
    } else if (fullBlock && !blindedBlock) {
      this.logger.debug("Selected engine block: no builder block produced", {
        // winston logger doesn't like bigint
        engineBlockValue: `${engineBlockValue}`,
      });
      return this.getBlockWithDebugLog(fullBlock, "engine", feeRecipientCheck);
    } else if (blindedBlock && !fullBlock) {
      this.logger.debug("Selected builder block: no engine block produced", {
        // winston logger doesn't like bigint
        builderBlockValue: `${builderBlockValue}`,
      });
      return this.getBlockWithDebugLog(blindedBlock, "builder", feeRecipientCheck);
    } else {
      throw Error("Failed to produce engine or builder block");
    }
  };

  private getBlockWithDebugLog(
    fullOrBlindedBlock: {data: allForks.FullOrBlindedBeaconBlock; blockValue: Wei},
    source: string,
    {expectedFeeRecipient, strictFeeRecipientCheck}: {expectedFeeRecipient: string; strictFeeRecipientCheck: boolean}
  ): {data: allForks.FullOrBlindedBeaconBlock} & {debugLogCtx: Record<string, string>} {
    const debugLogCtx = {
      source: source,
      // winston logger doesn't like bigint
      "blockValue(eth)": `${fullOrBlindedBlock.blockValue / ETH_TO_WEI}`,
    };
    const blockFeeRecipient = (fullOrBlindedBlock.data as bellatrix.BeaconBlock).body.executionPayload?.feeRecipient;
    const feeRecipient = blockFeeRecipient !== undefined ? toHexString(blockFeeRecipient) : undefined;

    if (source === "engine") {
      if (feeRecipient !== undefined) {
        if (feeRecipient !== expectedFeeRecipient && strictFeeRecipientCheck) {
          throw Error(`Invalid feeRecipient=${feeRecipient}, expected=${expectedFeeRecipient}`);
        }
      }
    }

    const transactions = (fullOrBlindedBlock.data as bellatrix.BeaconBlock).body.executionPayload?.transactions.length;
    const withdrawals = (fullOrBlindedBlock.data as capella.BeaconBlock).body.executionPayload?.withdrawals?.length;
    Object.assign(debugLogCtx, {feeRecipient, transactions}, withdrawals !== undefined ? {withdrawals} : {});

    return {...fullOrBlindedBlock, debugLogCtx};
  }

  /** Wrapper around the API's different methods for producing blocks across forks */
  private produceBlock: ServerApi<Api["validator"]>["produceBlock"] = async (slot, randaoReveal, graffiti) => {
    switch (this.config.getForkName(slot)) {
      case ForkName.phase0: {
        const res = await this.api.validator.produceBlock(slot, randaoReveal, graffiti);
        ApiError.assert(res, "Failed to produce block: validator.produceBlock");
        return res.response;
      }
      // All subsequent forks are expected to use v2 too
      case ForkName.altair:
      default: {
        const res = await this.api.validator.produceBlockV2(slot, randaoReveal, graffiti);
        ApiError.assert(res, "Failed to produce block: validator.produceBlockV2");
        return res.response;
      }
    }
  };

  private produceBlindedBlock: ServerApi<Api["validator"]>["produceBlindedBlock"] = async (
    slot,
    randaoReveal,
    graffiti
  ) => {
    const res = await this.api.validator.produceBlindedBlock(slot, randaoReveal, graffiti);
    ApiError.assert(res, "Failed to produce block: validator.produceBlindedBlock");
    return res.response;
  };
}
