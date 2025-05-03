import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkPostBellatrix, ForkPostDeneb, ForkPreDeneb, ForkSeq} from "@lodestar/params";
import {
  BLSPubkey,
  BLSSignature,
  BeaconBlock,
  BeaconBlockOrContents,
  BlindedBeaconBlock,
  ProducedBlockSource,
  SignedBeaconBlock,
  SignedBlindedBeaconBlock,
  Slot,
  deneb,
  isBlindedSignedBeaconBlock,
  isBlockContents,
} from "@lodestar/types";
import {extendError, prettyBytes, prettyWeiToEth, toPubkeyHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {PubkeyHex} from "../types.js";
import {IClock, LoggerVc} from "../util/index.js";
import {BlockDutiesService, GENESIS_SLOT} from "./blockDuties.js";
import {ValidatorStore} from "./validatorStore.js";

// The following combination of blocks and blobs can be produced
//  i) a full block pre deneb
//  ii) a full block and full blobs post deneb
//  iii) a blinded block post bellatrix
type FullOrBlindedBlockWithContents =
  | {
      version: ForkPreDeneb;
      block: BeaconBlock<ForkPreDeneb>;
      contents: null;
      executionPayloadBlinded: false;
      executionPayloadSource: ProducedBlockSource.engine;
    }
  | {
      version: ForkPostDeneb;
      block: BeaconBlock<ForkPostDeneb>;
      contents: {
        kzgProofs: deneb.KZGProofs;
        blobs: deneb.Blobs;
      };
      executionPayloadBlinded: false;
      executionPayloadSource: ProducedBlockSource.engine;
    }
  | {
      version: ForkPostBellatrix;
      block: BlindedBeaconBlock;
      contents: null;
      executionPayloadBlinded: true;
      executionPayloadSource: ProducedBlockSource;
    };

type DebugLogCtx = {debugLogCtx: Record<string, string | boolean | undefined>};
type BlockProposalOpts = {
  broadcastValidation: routes.beacon.BroadcastValidation;
  blindedLocal: boolean;
};
/**
 * Service that sets up and handles validator block proposal duties.
 */
export class BlockProposingService {
  private readonly dutiesService: BlockDutiesService;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly metrics: Metrics | null,
    private readonly opts: BlockProposalOpts
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
    const pubkeyHex = toPubkeyHex(pubkey);
    const logCtx = {slot, validator: prettyBytes(pubkeyHex)};

    // Wrap with try catch here to re-use `logCtx`
    try {
      const randaoReveal = await this.validatorStore.signRandao(pubkey, slot);
      const graffiti = this.validatorStore.getGraffiti(pubkeyHex);

      const debugLogCtx = {...logCtx, validator: pubkeyHex};

      const strictFeeRecipientCheck = this.validatorStore.strictFeeRecipientCheck(pubkeyHex);
      const {selection: builderSelection, boostFactor: builderBoostFactor} =
        this.validatorStore.getBuilderSelectionParams(pubkeyHex);
      const feeRecipient = this.validatorStore.getFeeRecipient(pubkeyHex);
      const blindedLocal = this.opts.blindedLocal;

      this.logger.debug("Producing block", {
        ...debugLogCtx,
        builderSelection,
        builderBoostFactor,
        feeRecipient,
        strictFeeRecipientCheck,
        blindedLocal,
      });
      this.metrics?.proposerStepCallProduceBlock.observe(this.clock.secFromSlot(slot));

      const produceOpts = {
        feeRecipient,
        strictFeeRecipientCheck,
        blindedLocal,
      };
      const blockContents = await this.produceBlockWrapper(
        this.config,
        slot,
        randaoReveal,
        graffiti,
        builderBoostFactor,
        produceOpts,
        builderSelection
      ).catch((e: Error) => {
        this.metrics?.blockProposingErrors.inc({error: "produce"});
        throw extendError(e, "Failed to produce block");
      });

      this.logger.debug("Produced block", {...debugLogCtx, ...blockContents.debugLogCtx});
      this.metrics?.blocksProduced.inc();

      const signedBlock = await this.validatorStore.signBlock(pubkey, blockContents.block, slot, this.logger);

      const {broadcastValidation} = this.opts;
      const publishOpts = {broadcastValidation};
      await this.publishBlockWrapper(signedBlock, blockContents.contents, publishOpts).catch((e: Error) => {
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
    signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock,
    contents: {kzgProofs: deneb.KZGProofs; blobs: deneb.Blobs} | null,
    opts: {broadcastValidation?: routes.beacon.BroadcastValidation} = {}
  ): Promise<void> => {
    if (isBlindedSignedBeaconBlock(signedBlock)) {
      if (contents !== null) {
        this.logger.warn(
          "Ignoring contents while publishing blinded block - publishing beacon should assemble it from its local cache or builder"
        );
      }
      (await this.api.beacon.publishBlindedBlockV2({signedBlindedBlock: signedBlock, ...opts})).assertOk();
    } else {
      if (contents === null) {
        (await this.api.beacon.publishBlockV2({signedBlockOrContents: signedBlock, ...opts})).assertOk();
      } else {
        (
          await this.api.beacon.publishBlockV2({
            signedBlockOrContents: {...contents, signedBlock: signedBlock as SignedBeaconBlock<ForkPostDeneb>},
            ...opts,
          })
        ).assertOk();
      }
    }
  };

  private produceBlockWrapper = async (
    _config: ChainForkConfig,
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string | undefined,
    builderBoostFactor: bigint,
    {feeRecipient, strictFeeRecipientCheck, blindedLocal}: routes.validator.ExtraProduceBlockOpts,
    builderSelection: routes.validator.BuilderSelection
  ): Promise<FullOrBlindedBlockWithContents & DebugLogCtx> => {
    const res = await this.api.validator.produceBlockV3({
      slot,
      randaoReveal,
      graffiti,
      skipRandaoVerification: false,
      feeRecipient,
      builderSelection,
      strictFeeRecipientCheck,
      blindedLocal,
      builderBoostFactor,
    });
    const meta = res.meta();

    const debugLogCtx = {
      executionPayloadSource: meta.executionPayloadSource,
      executionPayloadBlinded: meta.executionPayloadBlinded,
      executionPayloadValue: prettyWeiToEth(meta.executionPayloadValue),
      consensusBlockValue: prettyWeiToEth(meta.consensusBlockValue),
      totalBlockValue: prettyWeiToEth(meta.executionPayloadValue + meta.consensusBlockValue),
      // TODO PR: should be used in api call instead of adding in log
      strictFeeRecipientCheck,
      builderSelection,
      api: "produceBlockV3",
    };

    return parseProduceBlockResponse({data: res.value(), ...meta}, debugLogCtx, builderSelection);
  };
}

function parseProduceBlockResponse(
  response: {data: BeaconBlockOrContents | BlindedBeaconBlock} & {
    executionPayloadSource: ProducedBlockSource;
    executionPayloadBlinded: boolean;
    version: ForkName;
  },
  debugLogCtx: Record<string, string | boolean | undefined>,
  builderSelection: routes.validator.BuilderSelection
): FullOrBlindedBlockWithContents & DebugLogCtx {
  const executionPayloadSource = response.executionPayloadSource;

  if (
    (builderSelection === routes.validator.BuilderSelection.BuilderOnly &&
      executionPayloadSource === ProducedBlockSource.engine) ||
    (builderSelection === routes.validator.BuilderSelection.ExecutionOnly &&
      executionPayloadSource === ProducedBlockSource.builder)
  ) {
    throw Error(
      `Block not produced as per desired builderSelection=${builderSelection} executionPayloadSource=${executionPayloadSource}`
    );
  }

  if (response.executionPayloadBlinded) {
    return {
      block: response.data,
      contents: null,
      version: response.version,
      executionPayloadBlinded: true,
      executionPayloadSource,
      debugLogCtx,
    } as FullOrBlindedBlockWithContents & DebugLogCtx;
  }

  const data = response.data;
  if (isBlockContents(data)) {
    return {
      block: data.block,
      contents: {blobs: data.blobs, kzgProofs: data.kzgProofs},
      version: response.version,
      executionPayloadBlinded: false,
      executionPayloadSource,
      debugLogCtx,
    } as FullOrBlindedBlockWithContents & DebugLogCtx;
  }

  return {
    block: response.data,
    contents: null,
    version: response.version,
    executionPayloadBlinded: false,
    executionPayloadSource,
    debugLogCtx,
  } as FullOrBlindedBlockWithContents & DebugLogCtx;
}
