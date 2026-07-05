import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD, ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {
  BLSPubkey,
  BLSSignature,
  BeaconBlock,
  BlindedBeaconBlock,
  BlockContents,
  ProducedBlockSource,
  SignedBlindedBeaconBlock,
  SignedBlockContents,
  Slot,
  isBlindedSignedBeaconBlock,
} from "@lodestar/types";
import {extendError, prettyBytes, prettyWeiToEth, toPubkeyHex, toRootHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {PubkeyHex} from "../types.js";
import {IClock, LoggerVc} from "../util/index.js";
import {BlockDutiesService, GENESIS_SLOT} from "./blockDuties.js";
import {ValidatorStore} from "./validatorStore.js";

// The following combination of blocks and blobs can be produced
//  i) a full block contents (eg block and all related data-layer data)
//  ii) a blinded block post bellatrix
type BlindedBlockOrBlockContents =
  | {
      blockContents: BlockContents;
      executionPayloadBlinded: false;
      executionPayloadSource: ProducedBlockSource.engine;
    }
  | {
      block: BlindedBeaconBlock;
      executionPayloadBlinded: true;
      executionPayloadSource: ProducedBlockSource;
    };

type DebugLogCtx = {debugLogCtx: Record<string, string | boolean | undefined>};
type BlockProposalOpts = {
  broadcastValidation: routes.beacon.BroadcastValidation;
  blindedLocal: boolean;
  includePayload: boolean;
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
    dutiesService: BlockDutiesService,
    private readonly metrics: Metrics | null,
    private readonly opts: BlockProposalOpts
  ) {
    this.dutiesService = dutiesService;
    this.dutiesService.setNotifyBlockProductionFn(this.notifyBlockProductionFn);
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
      const fork = this.config.getForkName(slot);

      // Gloas uses different block production flow
      if (isForkPostGloas(fork)) {
        return this.createAndPublishBlockGloas(pubkey, slot);
      }

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
      const blockContentsWrapper = await this.produceBlockWrapper(
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

      this.logger.debug("Produced block", {...debugLogCtx, ...blockContentsWrapper.debugLogCtx});
      this.metrics?.blocksProduced.inc();

      const block = blockContentsWrapper.executionPayloadBlinded
        ? blockContentsWrapper.block
        : blockContentsWrapper.blockContents.block;
      const signedBlock = await this.validatorStore.signBlock(pubkey, block, slot, this.logger);

      const {broadcastValidation} = this.opts;
      const publishOpts = {broadcastValidation};

      const signedBlindedBlockOrBlockContents = blockContentsWrapper.executionPayloadBlinded
        ? {signedBlock}
        : {signedBlock, ...blockContentsWrapper.blockContents};
      delete (signedBlindedBlockOrBlockContents as {block?: BeaconBlock}).block; // remove block if present

      await this.publishBlockWrapper(signedBlindedBlockOrBlockContents, publishOpts).catch((e: Error) => {
        this.metrics?.blockProposingErrors.inc({error: "publish"});
        throw extendError(e, "Failed to publish block");
      });

      this.metrics?.proposerStepCallPublishBlock.observe(this.clock.secFromSlot(slot));
      this.metrics?.blocksPublished.inc();
      this.logger.info("Published block", {...logCtx, graffiti, ...blockContentsWrapper.debugLogCtx});
    } catch (e) {
      this.logger.error("Error proposing block", logCtx, e as Error);
    }
  }

  /**
   * Gloas block production flow:
   * 1. Produce beacon block with execution payload bid, by default with full block contents
   *    (execution payload envelope, KZG proofs and blobs) if self-building (stateless flow)
   * 2. Sign and publish the beacon block
   * 3. If self-building, sign and publish the execution payload envelope
   *    - Stateless (default): envelope and blobs are available from step 1, publish
   *      `SignedExecutionPayloadEnvelopeContents` which works via any beacon node
   *    - Stateful (`includePayload=false`): fetch the envelope from the same beacon node
   *      that produced the block, which attaches cached blobs and KZG proofs on publish
   */
  private async createAndPublishBlockGloas(pubkey: BLSPubkey, slot: Slot): Promise<void> {
    const pubkeyHex = toPubkeyHex(pubkey);
    const logCtx = {slot, validator: prettyBytes(pubkeyHex)};
    const debugLogCtx = {slot, validator: pubkeyHex};

    const randaoReveal = await this.validatorStore.signRandao(pubkey, slot);
    const graffiti = this.validatorStore.getGraffiti(pubkeyHex);
    const feeRecipient = this.validatorStore.getFeeRecipient(pubkeyHex);
    const {broadcastValidation, includePayload} = this.opts;

    this.logger.debug("Producing block", {...debugLogCtx, feeRecipient, includePayload});
    this.metrics?.proposerStepCallProduceBlock.observe(this.clock.secFromSlot(slot));

    // Step 1: Produce beacon block with execution payload bid
    const blockRes = await this.api.validator
      .produceBlockV4({
        slot,
        randaoReveal,
        graffiti,
        feeRecipient,
        includePayload,
      })
      .catch((e: Error) => {
        this.metrics?.blockProposingErrors.inc({error: "produce"});
        throw extendError(e, "Failed to produce block");
      });
    const blockOrContents = blockRes.value();
    const blockMeta = blockRes.meta();
    const {executionPayloadIncluded} = blockMeta;
    const block = executionPayloadIncluded
      ? (blockOrContents as BlockContents<ForkPostGloas>).block
      : (blockOrContents as BeaconBlock<ForkPostGloas>);
    const beaconBlockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block);
    const blockRootHex = toRootHex(beaconBlockRoot);

    this.logger.debug("Produced block", {
      ...debugLogCtx,
      consensusBlockValue: prettyWeiToEth(blockMeta.consensusBlockValue),
      executionPayloadIncluded,
      blockRoot: blockRootHex,
    });
    this.metrics?.blocksProduced.inc();

    // Step 2: Sign and publish the beacon block
    const signedBlock = await this.validatorStore.signBlock(pubkey, block, slot, this.logger);

    // Publish the block first so it propagates as soon as possible. This reduces the chance other nodes
    // see the payload envelope before the block over gossip and have to queue it. There's also plenty of
    // time left in the slot to propagate the payload, so publishing it in parallel is unnecessary.
    (
      await this.api.beacon
        .publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation,
        })
        .catch((e: Error) => {
          this.metrics?.blockProposingErrors.inc({error: "publish"});
          throw extendError(e, "Failed to publish block");
        })
    ).assertOk();

    this.logger.debug("Published beacon block", {...debugLogCtx, broadcastValidation});

    const isSelfBuild = block.body.signedExecutionPayloadBid.message.builderIndex === BUILDER_INDEX_SELF_BUILD;

    if (isSelfBuild) {
      // Self-build: proposer is responsible for building and publishing the execution payload envelope
      if (executionPayloadIncluded) {
        // Stateless flow: envelope and blobs are already available from block production
        const {executionPayloadEnvelope, kzgProofs, blobs} = blockOrContents as BlockContents<ForkPostGloas>;

        // Step 3: Sign and publish the envelope with blobs and KZG proofs
        const signedEnvelope = await this.validatorStore.signExecutionPayloadEnvelope(
          pubkey,
          executionPayloadEnvelope,
          slot,
          this.logger
        );

        (
          await this.api.beacon
            .publishExecutionPayloadEnvelope({
              signedEnvelope: {signedExecutionPayloadEnvelope: signedEnvelope, kzgProofs, blobs},
              broadcastValidation,
            })
            .catch((e: Error) => {
              this.metrics?.blockProposingErrors.inc({error: "publish"});
              throw extendError(e, "Failed to publish execution payload envelope");
            })
        ).assertOk();
      } else {
        // Stateful flow: fetch the envelope from the same beacon node that produced the block
        const envelopeRes = await this.api.validator.getExecutionPayloadEnvelope({
          slot,
          beaconBlockRoot,
        });
        const envelope = envelopeRes.value();

        this.logger.debug("Retrieved execution payload envelope", debugLogCtx);

        // Step 3: Sign and publish the envelope, beacon node attaches blobs and KZG proofs from its cache
        const signedEnvelope = await this.validatorStore.signExecutionPayloadEnvelope(
          pubkey,
          envelope,
          slot,
          this.logger
        );

        (
          await this.api.beacon
            .publishExecutionPayloadEnvelope({
              signedEnvelope,
              broadcastValidation,
            })
            .catch((e: Error) => {
              this.metrics?.blockProposingErrors.inc({error: "publish"});
              throw extendError(e, "Failed to publish execution payload envelope");
            })
        ).assertOk();
      }

      this.logger.info("Published block and execution payload envelope", {
        ...logCtx,
        graffiti,
        consensusBlockValue: prettyWeiToEth(blockMeta.consensusBlockValue),
        blockRoot: blockRootHex,
      });
    } else {
      // Builder is responsible for broadcasting the execution payload envelope
      this.logger.info("Published block with builder bid, envelope expected from builder", {
        ...logCtx,
        graffiti,
        builderIndex: block.body.signedExecutionPayloadBid.message.builderIndex,
        consensusBlockValue: prettyWeiToEth(blockMeta.consensusBlockValue),
        blockRoot: blockRootHex,
      });
    }

    this.metrics?.proposerStepCallPublishBlock.observe(this.clock.secFromSlot(slot));
    this.metrics?.blocksPublished.inc();
  }

  private publishBlockWrapper = async (
    signedBlindedBlockOrBlockContents: SignedBlockContents | {signedBlock: SignedBlindedBeaconBlock},
    opts: {broadcastValidation?: routes.beacon.BroadcastValidation} = {}
  ): Promise<void> => {
    if (isBlindedSignedBeaconBlock(signedBlindedBlockOrBlockContents.signedBlock)) {
      (
        await this.api.beacon.publishBlindedBlockV2({
          signedBlindedBlock: signedBlindedBlockOrBlockContents.signedBlock,
          ...opts,
        })
      ).assertOk();
    } else {
      (
        await this.api.beacon.publishBlockV2({
          signedBlockContents: signedBlindedBlockOrBlockContents,
          ...opts,
        })
      ).assertOk();
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
  ): Promise<BlindedBlockOrBlockContents & DebugLogCtx> => {
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
  response: {data: BlockContents | BlindedBeaconBlock} & {
    executionPayloadSource: ProducedBlockSource;
    executionPayloadBlinded: boolean;
  },
  debugLogCtx: Record<string, string | boolean | undefined>,
  builderSelection: routes.validator.BuilderSelection
): BlindedBlockOrBlockContents & DebugLogCtx {
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
      executionPayloadBlinded: true,
      executionPayloadSource,
      debugLogCtx,
    } as BlindedBlockOrBlockContents & DebugLogCtx;
  }

  return {
    blockContents: response.data,
    executionPayloadBlinded: false,
    executionPayloadSource,
    debugLogCtx,
  } as BlindedBlockOrBlockContents & DebugLogCtx;
}
