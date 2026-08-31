import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD, ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {IClock} from "@lodestar/state-transition";
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
import {extendError, prettyBytes, prettyGweiToEth, prettyWeiToEth, toPubkeyHex, toRootHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {PubkeyHex} from "../types.js";
import {LoggerVc} from "../util/index.js";
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
  payloadLocal: boolean;
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
   * 1. Produce the beacon block, which commits to an execution payload bid. When self-building with
   *    the stateless flow (`payloadLocal=false`), the response also includes the full block contents
   *    (execution payload envelope, KZG proofs and blobs).
   * 2. Sign and publish the beacon block.
   * 3. Reveal the execution payload envelope:
   *    - Self-build: the proposer signs and publishes the envelope
   *      - Stateless (`payloadLocal=false`): envelope and blobs are already available from step 1,
   *        publish `SignedExecutionPayloadEnvelopeContents` which can be sent via any beacon node
   *      - Stateful (`payloadLocal=true`): fetch the envelope from the beacon node that produced the
   *        block, then publish the bare `SignedExecutionPayloadEnvelope` back to it; that node
   *        attaches the cached blobs and KZG proofs
   *    - Builder bid: the builder reveals the envelope, so the proposer does nothing further
   */
  private async createAndPublishBlockGloas(pubkey: BLSPubkey, slot: Slot): Promise<void> {
    const pubkeyHex = toPubkeyHex(pubkey);
    const logCtx = {slot, validator: prettyBytes(pubkeyHex)};
    const debugLogCtx = {slot, validator: pubkeyHex};

    const randaoReveal = await this.validatorStore.signRandao(pubkey, slot);
    const graffiti = this.validatorStore.getGraffiti(pubkeyHex);
    const feeRecipient = this.validatorStore.getFeeRecipient(pubkeyHex);
    const strictFeeRecipientCheck = this.validatorStore.strictFeeRecipientCheck(pubkeyHex);
    const {broadcastValidation, payloadLocal} = this.opts;
    const {selection: builderSelection, boostFactor: builderBoostFactor} =
      this.validatorStore.getBuilderSelectionParams(pubkeyHex, slot);
    const builderMinBid = this.validatorStore.getBuilderMinBid(pubkeyHex);
    const builderEntries = this.validatorStore.getResolvedBuilderEntries(pubkeyHex, builderBoostFactor);

    this.logger.debug("Producing block", {
      ...debugLogCtx,
      feeRecipient,
      strictFeeRecipientCheck,
      payloadLocal,
      builderSelection,
      builderBoostFactor,
      builderMinBid: prettyGweiToEth(builderMinBid),
      builderUrls: builderEntries.map((entry) => entry.url).join(","),
    });
    this.metrics?.proposerStepCallProduceBlock.observe(this.clock.secFromSlot(slot));

    // One entry per resolved builder, authenticated by a request auth signed over the entry's
    // auth data. The auth is usually pre-signed when preferences are submitted ahead of the
    // proposal. An entry whose auth cannot be signed is skipped so it never fails the proposal.
    const builders: routes.validator.BuilderEntry[] = (
      await Promise.all(
        builderEntries.map(async (entry) => {
          try {
            const auth = await this.validatorStore.getBuilderRequestAuth(pubkey, entry.authData, slot, slot);
            return {
              url: new TextEncoder().encode(entry.url),
              auth,
              builderPubkeys: entry.builderPubkeys,
              maxExecutionPayment: entry.maxExecutionPayment,
              minBid: entry.minBid,
              builderBoostFactor: entry.builderBoostFactor,
            };
          } catch (e) {
            this.logger.warn("Failed to sign builder request auth", {...logCtx, builderUrl: entry.url}, e as Error);
            return null;
          }
        })
      )
    ).filter((entry) => entry !== null);

    // Step 1: Produce beacon block with execution payload bid
    const blockRes = await this.api.validator
      .produceBlockV4({
        slot,
        randaoReveal,
        graffiti,
        feeRecipient,
        strictFeeRecipientCheck,
        includePayload: !payloadLocal,
        builderConfig: {
          minBid: builderMinBid,
          builderBoostFactor,
          builders,
        },
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
      executionPayloadValue: prettyWeiToEth(blockMeta.executionPayloadValue),
      consensusBlockValue: prettyWeiToEth(blockMeta.consensusBlockValue),
      totalBlockValue: prettyWeiToEth(blockMeta.executionPayloadValue + blockMeta.consensusBlockValue),
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
          // Echo the winning builder url so any beacon node can forward the block to the builder
          builderUrl: blockMeta.builderUrl,
        })
        .catch((e: Error) => {
          this.metrics?.blockProposingErrors.inc({error: "publish"});
          throw extendError(e, `Failed to publish block slot=${slot} blockRoot=${blockRootHex}`);
        })
    ).assertOk();

    this.logger.info("Published beacon block", {
      ...logCtx,
      graffiti,
      executionPayloadValue: prettyWeiToEth(blockMeta.executionPayloadValue),
      consensusBlockValue: prettyWeiToEth(blockMeta.consensusBlockValue),
      totalBlockValue: prettyWeiToEth(blockMeta.executionPayloadValue + blockMeta.consensusBlockValue),
      blockRoot: blockRootHex,
      broadcastValidation,
    });
    this.metrics?.proposerStepCallPublishBlock.observe(this.clock.secFromSlot(slot));
    this.metrics?.blocksPublished.inc();

    const isSelfBuild = block.body.signedExecutionPayloadBid.message.builderIndex === BUILDER_INDEX_SELF_BUILD;

    if (isSelfBuild) {
      // Self-build: proposer is responsible for building and publishing the execution payload envelope
      const flow = executionPayloadIncluded ? "stateless" : "stateful";
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
              signedEnvelopeOrContents: {signedExecutionPayloadEnvelope: signedEnvelope, kzgProofs, blobs},
              broadcastValidation,
            })
            .catch((e: Error) => {
              this.metrics?.payloadEnvelopeProposingErrors.inc({error: "publish"});
              throw extendError(
                e,
                `Failed to publish execution payload envelope slot=${slot} blockRoot=${blockRootHex} flow=${flow}`
              );
            })
        ).assertOk();
      } else {
        // Stateful flow: fetch the envelope from the same beacon node that produced the block
        const envelopeRes = await this.api.validator
          .getExecutionPayloadEnvelope({
            slot,
            beaconBlockRoot,
          })
          .catch((e: Error) => {
            this.metrics?.payloadEnvelopeProposingErrors.inc({error: "produce"});
            throw extendError(e, `Failed to get execution payload envelope slot=${slot} blockRoot=${blockRootHex}`);
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
              signedEnvelopeOrContents: signedEnvelope,
              broadcastValidation,
            })
            .catch((e: Error) => {
              this.metrics?.payloadEnvelopeProposingErrors.inc({error: "publish"});
              throw extendError(
                e,
                `Failed to publish execution payload envelope slot=${slot} blockRoot=${blockRootHex} flow=${flow}`
              );
            })
        ).assertOk();
      }

      this.logger.info("Published execution payload envelope", {
        ...logCtx,
        blockRoot: blockRootHex,
        flow,
      });
    } else {
      // Committed to a builder bid, the builder is responsible for revealing the execution payload envelope
      this.logger.info("Execution payload envelope to be revealed by builder", {
        ...logCtx,
        builderIndex: block.body.signedExecutionPayloadBid.message.builderIndex,
        blockRoot: blockRootHex,
      });
    }
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
    builderSelection === routes.validator.BuilderSelection.ExecutionOnly &&
    executionPayloadSource === ProducedBlockSource.builder
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
