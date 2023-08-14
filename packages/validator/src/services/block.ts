import {toHexString} from "@chainsafe/ssz";
import {
  BLSPubkey,
  Slot,
  BLSSignature,
  allForks,
  bellatrix,
  capella,
  isBlindedBeaconBlock,
  Wei,
  ProducedBlockSource,
  deneb,
} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {extendError, prettyBytes, racePromisesWithCutoff, RaceEvent} from "@lodestar/utils";
import {
  Api,
  ApiError,
  isBlockContents,
  isBlindedBlockContents,
  SignedBlindedBlockContents,
  SignedBlockContents,
  BlockContents,
  BlindedBlockContents,
} from "@lodestar/api";
import {IClock, LoggerVc} from "../util/index.js";
import {PubkeyHex} from "../types.js";
import {Metrics} from "../metrics.js";
import {formatBigDecimal} from "../util/format.js";
import {ValidatorStore, BuilderSelection} from "./validatorStore.js";
import {BlockDutiesService, GENESIS_SLOT} from "./blockDuties.js";

const ETH_TO_WEI = BigInt("1000000000000000000");
// display upto 5 decimal places
const MAX_DECIMAL_FACTOR = BigInt("100000");

/**
 * Cutoff time to wait for execution and builder block production apis to resolve
 * Post this time, race execution and builder to pick whatever resolves first
 *
 * Emprically the builder block resolves in ~1.5+ seconds, and executon should resolve <1 sec.
 * So lowering the cutoff to 2 sec from 3 seconds to publish faster for successful proposal
 * as proposals post 4 seconds into the slot seems to be not being included
 */
const BLOCK_PRODUCTION_RACE_CUTOFF_MS = 2_000;
/** Overall timeout for execution and block production apis */
const BLOCK_PRODUCTION_RACE_TIMEOUT_MS = 12_000;

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
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: Api,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly metrics: Metrics | null
  ) {
    this.dutiesService = new BlockDutiesService(
      config,
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

      const strictFeeRecipientCheck = this.validatorStore.strictFeeRecipientCheck(pubkeyHex);
      const isBuilderEnabled = this.validatorStore.isBuilderEnabled(pubkeyHex);
      const builderSelection = this.validatorStore.getBuilderSelection(pubkeyHex);
      const expectedFeeRecipient = this.validatorStore.getFeeRecipient(pubkeyHex);

      this.logger.debug("Producing block", {
        ...debugLogCtx,
        isBuilderEnabled,
        builderSelection,
        expectedFeeRecipient,
        strictFeeRecipientCheck,
      });
      this.metrics?.proposerStepCallProduceBlock.observe(this.clock.secFromSlot(slot));

      const blockContents = await this.produceBlockWrapper(slot, randaoReveal, graffiti, {
        expectedFeeRecipient,
        strictFeeRecipientCheck,
        isBuilderEnabled,
        builderSelection,
      }).catch((e: Error) => {
        this.metrics?.blockProposingErrors.inc({error: "produce"});
        throw extendError(e, "Failed to produce block");
      });

      this.logger.debug("Produced block", {...debugLogCtx, ...blockContents.debugLogCtx});
      this.metrics?.blocksProduced.inc();

      const signedBlockPromise = this.validatorStore.signBlock(pubkey, blockContents.block, slot);
      const signedBlobPromises =
        blockContents.blobs !== undefined
          ? blockContents.blobs.map((blob) => this.validatorStore.signBlob(pubkey, blob, slot))
          : undefined;
      let signedBlock: allForks.FullOrBlindedSignedBeaconBlock,
        signedBlobs: allForks.FullOrBlindedSignedBlobSidecar[] | undefined;
      if (signedBlobPromises !== undefined) {
        [signedBlock, ...signedBlobs] = await Promise.all([signedBlockPromise, ...signedBlobPromises]);
      } else {
        signedBlock = await signedBlockPromise;
        signedBlobs = undefined;
      }

      await this.publishBlockWrapper(signedBlock, signedBlobs).catch((e: Error) => {
        this.metrics?.blockProposingErrors.inc({error: "publish"});
        throw extendError(e, "Failed to publish block");
      });
      this.metrics?.proposerStepCallPublishBlock.observe(this.clock.secFromSlot(slot));
      this.metrics?.blocksPublished.inc();
      this.logger.info("Published block", {...logCtx, graffiti, ...blockContents.debugLogCtx});
    } catch (e) {
      this.logger.error("Error proposing block", logCtx, e as Error);
    }
  }

  private publishBlockWrapper = async (
    signedBlock: allForks.FullOrBlindedSignedBeaconBlock,
    signedBlobSidecars?: allForks.FullOrBlindedSignedBlobSidecar[]
  ): Promise<void> => {
    if (signedBlobSidecars === undefined) {
      ApiError.assert(
        isBlindedBeaconBlock(signedBlock.message)
          ? await this.api.beacon.publishBlindedBlock(signedBlock as allForks.SignedBlindedBeaconBlock)
          : await this.api.beacon.publishBlock(signedBlock as allForks.SignedBeaconBlock)
      );
    } else {
      ApiError.assert(
        isBlindedBeaconBlock(signedBlock.message)
          ? await this.api.beacon.publishBlindedBlock({
              signedBlindedBlock: signedBlock,
              signedBlindedBlobSidecars: signedBlobSidecars,
            } as SignedBlindedBlockContents)
          : await this.api.beacon.publishBlock({signedBlock, signedBlobSidecars} as SignedBlockContents)
      );
    }
  };

  private produceBlockWrapper = async (
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string,
    {expectedFeeRecipient, strictFeeRecipientCheck, isBuilderEnabled, builderSelection}: ProduceBlockOpts
  ): Promise<
    {block: allForks.FullOrBlindedBeaconBlock; blobs?: allForks.FullOrBlindedBlobSidecars} & {
      debugLogCtx: Record<string, string>;
    }
  > => {
    // Start calls for building execution and builder blocks
    const blindedBlockPromise = isBuilderEnabled ? this.produceBlindedBlock(slot, randaoReveal, graffiti) : null;
    const fullBlockPromise =
      // At any point either the builder or execution or both flows should be active.
      //
      // Ideally such a scenario should be prevented on startup, but proposerSettingsFile or keymanager
      // configurations could cause a validator pubkey to have builder disabled with builder selection builder only
      // (TODO: independently make sure such an options update is not successful for a validator pubkey)
      //
      // So if builder is disabled ignore builder selection of builderonly if caused by user mistake
      !isBuilderEnabled || builderSelection !== BuilderSelection.BuilderOnly
        ? this.produceBlock(slot, randaoReveal, graffiti, expectedFeeRecipient)
        : null;

    let blindedBlock, fullBlock;
    if (blindedBlockPromise !== null && fullBlockPromise !== null) {
      // reference index of promises in the race
      const promisesOrder = [ProducedBlockSource.builder, ProducedBlockSource.engine];
      [blindedBlock, fullBlock] = await racePromisesWithCutoff<{
        block: allForks.FullOrBlindedBeaconBlock;
        blobs?: allForks.FullOrBlindedBlobSidecars;
        blockValue: Wei;
      }>(
        [blindedBlockPromise, fullBlockPromise],
        BLOCK_PRODUCTION_RACE_CUTOFF_MS,
        BLOCK_PRODUCTION_RACE_TIMEOUT_MS,
        // Callback to log the race events for better debugging capability
        (event: RaceEvent, delayMs: number, index?: number) => {
          const eventRef = index !== undefined ? {source: promisesOrder[index]} : {};
          this.logger.debug("Block production race (builder vs execution)", {
            event,
            ...eventRef,
            delayMs,
            cutoffMs: BLOCK_PRODUCTION_RACE_CUTOFF_MS,
            timeoutMs: BLOCK_PRODUCTION_RACE_TIMEOUT_MS,
          });
        }
      );
      if (blindedBlock instanceof Error) {
        // error here means race cutoff exceeded
        this.logger.error("Failed to produce builder block", {}, blindedBlock);
        blindedBlock = null;
      }
      if (fullBlock instanceof Error) {
        this.logger.error("Failed to produce execution block", {}, fullBlock);
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

    const builderBlockValue = blindedBlock?.blockValue ?? BigInt(0);
    const engineBlockValue = fullBlock?.blockValue ?? BigInt(0);

    const feeRecipientCheck = {expectedFeeRecipient, strictFeeRecipientCheck};

    if (fullBlock && blindedBlock) {
      let selectedSource: ProducedBlockSource;
      let selectedBlock;
      switch (builderSelection) {
        case BuilderSelection.MaxProfit: {
          // If blockValues are zero, than choose builder as most likely beacon didn't provide blockValues
          // and builder blocks are most likely thresholded by a min bid
          if (engineBlockValue >= builderBlockValue && engineBlockValue !== BigInt(0)) {
            selectedSource = ProducedBlockSource.engine;
            selectedBlock = fullBlock;
          } else {
            selectedSource = ProducedBlockSource.builder;
            selectedBlock = blindedBlock;
          }
          break;
        }

        // For everything else just select the builder
        default: {
          selectedSource = ProducedBlockSource.builder;
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
      return this.getBlockWithDebugLog(fullBlock, ProducedBlockSource.engine, feeRecipientCheck);
    } else if (blindedBlock && !fullBlock) {
      this.logger.debug("Selected builder block: no engine block produced", {
        // winston logger doesn't like bigint
        builderBlockValue: `${builderBlockValue}`,
      });
      return this.getBlockWithDebugLog(blindedBlock, ProducedBlockSource.builder, feeRecipientCheck);
    } else {
      throw Error("Failed to produce engine or builder block");
    }
  };

  private getBlockWithDebugLog(
    fullOrBlindedBlock: {
      block: allForks.FullOrBlindedBeaconBlock;
      blockValue: Wei;
      blobs?: allForks.FullOrBlindedBlobSidecars;
    },
    source: ProducedBlockSource,
    {expectedFeeRecipient, strictFeeRecipientCheck}: {expectedFeeRecipient: string; strictFeeRecipientCheck: boolean}
  ): {block: allForks.FullOrBlindedBeaconBlock; blobs?: allForks.FullOrBlindedBlobSidecars} & {
    debugLogCtx: Record<string, string>;
  } {
    const debugLogCtx = {
      source: source,
      // winston logger doesn't like bigint
      blockValue: `${formatBigDecimal(fullOrBlindedBlock.blockValue, ETH_TO_WEI, MAX_DECIMAL_FACTOR)} ETH`,
    };
    const blockFeeRecipient = (fullOrBlindedBlock.block as bellatrix.BeaconBlock).body.executionPayload?.feeRecipient;
    const feeRecipient = blockFeeRecipient !== undefined ? toHexString(blockFeeRecipient) : undefined;

    if (source === ProducedBlockSource.engine) {
      if (feeRecipient !== undefined) {
        if (feeRecipient !== expectedFeeRecipient && strictFeeRecipientCheck) {
          throw Error(`Invalid feeRecipient=${feeRecipient}, expected=${expectedFeeRecipient}`);
        }
      }
    }

    const transactions = (fullOrBlindedBlock.block as bellatrix.BeaconBlock).body.executionPayload?.transactions
      ?.length;
    const withdrawals = (fullOrBlindedBlock.block as capella.BeaconBlock).body.executionPayload?.withdrawals?.length;

    // feeRecipient, transactions or withdrawals can end up undefined
    Object.assign(
      debugLogCtx,
      feeRecipient !== undefined ? {feeRecipient} : {},
      transactions !== undefined ? {transactions} : {},
      withdrawals !== undefined ? {withdrawals} : {}
    );
    Object.assign(debugLogCtx, fullOrBlindedBlock.blobs !== undefined ? {blobs: fullOrBlindedBlock.blobs.length} : {});

    return {...fullOrBlindedBlock, blobs: fullOrBlindedBlock.blobs, debugLogCtx};
  }

  /** Wrapper around the API's different methods for producing blocks across forks */
  private produceBlock = async (
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string,
    expectedFeeRecipient?: string
  ): Promise<{block: allForks.BeaconBlock; blobs?: deneb.BlobSidecars; blockValue: Wei}> => {
    const fork = this.config.getForkName(slot);
    switch (fork) {
      case ForkName.phase0: {
        const res = await this.api.validator.produceBlock(slot, randaoReveal, graffiti);
        ApiError.assert(res, "Failed to produce block: validator.produceBlock");
        const {data: block, blockValue} = res.response;
        return {block, blockValue};
      }

      // All subsequent forks are expected to use v2 too
      case ForkName.altair:
      case ForkName.bellatrix:
      case ForkName.capella: {
        const res = await this.api.validator.produceBlockV2(slot, randaoReveal, graffiti, expectedFeeRecipient);
        ApiError.assert(res, "Failed to produce block: validator.produceBlockV2");

        const {response} = res;
        if (isBlockContents(response.data)) {
          throw Error(`Invalid BlockContents response at fork=${fork}`);
        }
        const {data: block, blockValue} = response as {data: allForks.BeaconBlock; blockValue: Wei};
        return {block, blockValue};
      }

      case ForkName.deneb:
      default: {
        const res = await this.api.validator.produceBlockV2(slot, randaoReveal, graffiti, expectedFeeRecipient);
        ApiError.assert(res, "Failed to produce block: validator.produceBlockV2");

        const {response} = res;
        if (!isBlockContents(response.data)) {
          throw Error(`Expected BlockContents response at fork=${fork}`);
        }
        const {
          data: {block, blobSidecars: blobs},
          blockValue,
        } = response as {data: BlockContents; blockValue: Wei};
        return {block, blobs, blockValue};
      }
    }
  };

  private produceBlindedBlock = async (
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string
  ): Promise<{block: allForks.BlindedBeaconBlock; blockValue: Wei; blobs?: deneb.BlindedBlobSidecars}> => {
    const res = await this.api.validator.produceBlindedBlock(slot, randaoReveal, graffiti);
    ApiError.assert(res, "Failed to produce block: validator.produceBlindedBlock");
    const {response} = res;

    const fork = this.config.getForkName(slot);
    switch (fork) {
      case ForkName.phase0:
      case ForkName.altair:
        throw Error(`BlindedBlock functionality not applicable at fork=${fork}`);

      case ForkName.bellatrix:
      case ForkName.capella: {
        if (isBlindedBlockContents(response.data)) {
          throw Error(`Invalid BlockContents response at fork=${fork}`);
        }
        const {data: block, blockValue} = response as {data: allForks.BlindedBeaconBlock; blockValue: Wei};
        return {block, blockValue};
      }

      case ForkName.deneb:
      default: {
        if (!isBlindedBlockContents(response.data)) {
          throw Error(`Expected BlockContents response at fork=${fork}`);
        }
        const {
          data: {blindedBlock: block, blindedBlobSidecars: blobs},
          blockValue,
        } = response as {data: BlindedBlockContents; blockValue: Wei};
        return {block, blobs, blockValue};
      }
    }
  };
}
