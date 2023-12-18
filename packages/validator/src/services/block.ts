import {toHexString} from "@chainsafe/ssz";
import {
  BLSPubkey,
  Slot,
  BLSSignature,
  allForks,
  isBlindedBeaconBlock,
  ProducedBlockSource,
  deneb,
  isBlockContents,
  isBlindedBlockContents,
} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {ForkPreBlobs, ForkBlobs, ForkSeq} from "@lodestar/params";
import {extendError, prettyBytes} from "@lodestar/utils";
import {Api, ApiError, routes} from "@lodestar/api";
import {IClock, LoggerVc} from "../util/index.js";
import {PubkeyHex} from "../types.js";
import {Metrics} from "../metrics.js";
import {formatBigDecimal} from "../util/format.js";
import {ValidatorStore} from "./validatorStore.js";
import {BlockDutiesService, GENESIS_SLOT} from "./blockDuties.js";

const ETH_TO_WEI = BigInt("1000000000000000000");
// display upto 5 decimal places
const MAX_DECIMAL_FACTOR = BigInt("100000");

// The following combination of blocks and blobs can be produced
//  i) a full block pre deneb
//  ii) a full block and full blobs post deneb
//  iii) a blinded block pre deneb as a result of beacon/execution race
//  iv) a blinded block + blinded blobs as a result of beacon/execution race
type FullOrBlindedBlockWithContents =
  | {
      version: ForkPreBlobs;
      block: allForks.BeaconBlock;
      blobs: null;
      executionPayloadBlinded: false;
    }
  | {
      version: ForkBlobs;
      block: allForks.BeaconBlock;
      blobs: deneb.BlobSidecars;
      executionPayloadBlinded: false;
    }
  | {
      version: ForkPreBlobs;
      block: allForks.BlindedBeaconBlock;
      blobs: null;
      executionPayloadBlinded: true;
    }
  | {
      version: ForkBlobs;
      block: allForks.BlindedBeaconBlock;
      blobs: deneb.BlindedBlobSidecars;
      executionPayloadBlinded: true;
    };

type DebugLogCtx = {debugLogCtx: Record<string, string | boolean | undefined>};
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
    private readonly metrics: Metrics | null,
    private readonly opts: {useProduceBlockV3: boolean; broadcastValidation: routes.beacon.BroadcastValidation}
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
      const builderSelection = this.validatorStore.getBuilderSelection(pubkeyHex);
      const feeRecipient = this.validatorStore.getFeeRecipient(pubkeyHex);

      this.logger.debug("Producing block", {
        ...debugLogCtx,
        builderSelection,
        feeRecipient,
        strictFeeRecipientCheck,
        useProduceBlockV3: this.opts.useProduceBlockV3,
      });
      this.metrics?.proposerStepCallProduceBlock.observe(this.clock.secFromSlot(slot));

      const produceBlockFn = this.opts.useProduceBlockV3 ? this.produceBlockWrapper : this.produceBlockV2Wrapper;
      const blockContents = await produceBlockFn(this.config, slot, randaoReveal, graffiti, {
        feeRecipient,
        strictFeeRecipientCheck,
        builderSelection,
      }).catch((e: Error) => {
        this.metrics?.blockProposingErrors.inc({error: "produce"});
        throw extendError(e, "Failed to produce block");
      });

      this.logger.debug("Produced block", {...debugLogCtx, ...blockContents.debugLogCtx});
      this.metrics?.blocksProduced.inc();

      const signedBlockPromise = this.validatorStore.signBlock(pubkey, blockContents.block, slot, this.logger);
      const signedBlobPromises =
        blockContents.blobs !== null
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

      await this.publishBlockWrapper(signedBlock, signedBlobs, {
        broadcastValidation: this.opts.broadcastValidation,
      }).catch((e: Error) => {
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
    signedBlobSidecars?: allForks.FullOrBlindedSignedBlobSidecar[],
    opts: {broadcastValidation?: routes.beacon.BroadcastValidation} = {}
  ): Promise<void> => {
    if (signedBlobSidecars === undefined) {
      ApiError.assert(
        isBlindedBeaconBlock(signedBlock.message)
          ? await this.api.beacon.publishBlindedBlockV2(signedBlock as allForks.SignedBlindedBeaconBlock, opts)
          : await this.api.beacon.publishBlockV2(signedBlock as allForks.SignedBeaconBlock, opts)
      );
    } else {
      ApiError.assert(
        isBlindedBeaconBlock(signedBlock.message)
          ? await this.api.beacon.publishBlindedBlockV2(
              {
                signedBlindedBlock: signedBlock,
                signedBlindedBlobSidecars: signedBlobSidecars,
              } as allForks.SignedBlindedBlockContents,
              opts
            )
          : await this.api.beacon.publishBlockV2(
              {signedBlock, signedBlobSidecars} as allForks.SignedBlockContents,
              opts
            )
      );
    }
  };

  private produceBlockWrapper = async (
    _config: ChainForkConfig,
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string,
    {feeRecipient, strictFeeRecipientCheck, builderSelection}: routes.validator.ExtraProduceBlockOps
  ): Promise<FullOrBlindedBlockWithContents & DebugLogCtx> => {
    const res = await this.api.validator.produceBlockV3(slot, randaoReveal, graffiti, false, {
      feeRecipient,
      builderSelection,
      strictFeeRecipientCheck,
    });
    ApiError.assert(res, "Failed to produce block: validator.produceBlockV2");
    const {response} = res;

    const debugLogCtx = {
      source: response.executionPayloadBlinded ? ProducedBlockSource.builder : ProducedBlockSource.engine,
      // winston logger doesn't like bigint
      executionPayloadValue: `${formatBigDecimal(response.executionPayloadValue, ETH_TO_WEI, MAX_DECIMAL_FACTOR)} ETH`,
      consensusBlockValue: `${formatBigDecimal(response.consensusBlockValue, ETH_TO_WEI, MAX_DECIMAL_FACTOR)} ETH`,
      totalBlockValue: `${formatBigDecimal(
        response.executionPayloadValue + response.consensusBlockValue,
        ETH_TO_WEI,
        MAX_DECIMAL_FACTOR
      )} ETH`,
      // TODO PR: should be used in api call instead of adding in log
      strictFeeRecipientCheck,
      builderSelection,
      api: "produceBlockV3",
    };

    return parseProduceBlockResponse(response, debugLogCtx);
  };

  /** a wrapper function used for backward compatibility with the clients who don't have v3 implemented yet */
  private produceBlockV2Wrapper = async (
    config: ChainForkConfig,
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string,
    {builderSelection}: routes.validator.ExtraProduceBlockOps
  ): Promise<FullOrBlindedBlockWithContents & DebugLogCtx> => {
    // other clients have always implemented builder vs execution race in produce blinded block
    // so if builderSelection is executiononly then only we call produceBlockV2 else produceBlockV3 always
    const debugLogCtx = {builderSelection};
    const fork = config.getForkName(slot);

    if (ForkSeq[fork] < ForkSeq.bellatrix || builderSelection === routes.validator.BuilderSelection.ExecutionOnly) {
      Object.assign(debugLogCtx, {api: "produceBlockV2"});
      const res = await this.api.validator.produceBlockV2(slot, randaoReveal, graffiti);
      ApiError.assert(res, "Failed to produce block: validator.produceBlockV2");
      const {response} = res;
      return parseProduceBlockResponse({executionPayloadBlinded: false, ...response}, debugLogCtx);
    } else {
      Object.assign(debugLogCtx, {api: "produceBlindedBlock"});
      const res = await this.api.validator.produceBlindedBlock(slot, randaoReveal, graffiti);
      ApiError.assert(res, "Failed to produce block: validator.produceBlockV2");
      const {response} = res;

      return parseProduceBlockResponse({executionPayloadBlinded: true, ...response}, debugLogCtx);
    }
  };
}

function parseProduceBlockResponse(
  response: routes.validator.ProduceFullOrBlindedBlockOrContentsRes,
  debugLogCtx: Record<string, string | boolean | undefined>
): FullOrBlindedBlockWithContents & DebugLogCtx {
  if (response.executionPayloadBlinded) {
    if (isBlindedBlockContents(response.data)) {
      return {
        block: response.data.blindedBlock,
        blobs: response.data.blindedBlobSidecars,
        version: response.version,
        executionPayloadBlinded: true,
        debugLogCtx,
      } as FullOrBlindedBlockWithContents & DebugLogCtx;
    } else {
      return {
        block: response.data,
        blobs: null,
        version: response.version,
        executionPayloadBlinded: true,
        debugLogCtx,
      } as FullOrBlindedBlockWithContents & DebugLogCtx;
    }
  } else {
    if (isBlockContents(response.data)) {
      return {
        block: response.data.block,
        blobs: response.data.blobSidecars,
        version: response.version,
        executionPayloadBlinded: false,
        debugLogCtx,
      } as FullOrBlindedBlockWithContents & DebugLogCtx;
    } else {
      return {
        block: response.data,
        blobs: null,
        version: response.version,
        executionPayloadBlinded: false,
        debugLogCtx,
      } as FullOrBlindedBlockWithContents & DebugLogCtx;
    }
  }
}
