import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ExecutionStatus, PayloadStatus} from "@lodestar/fork-choice";
import {
  BUILDER_INDEX_SELF_BUILD,
  ForkName,
  ForkPostBellatrix,
  ForkPreGloas,
  ForkSeq,
  SYNC_COMMITTEE_SUBNET_SIZE,
  isForkPostElectra,
  isForkPostFulu,
  isForkPostGloas,
} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  beaconBlockToBlinded,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  computeTimeAtSlot,
  getCurrentSlot,
} from "@lodestar/state-transition";
import {
  BeaconBlock,
  BlindedBeaconBlock,
  BlockContents,
  CommitteeIndex,
  Epoch,
  ProducedBlockSource,
  Root,
  Slot,
  ValidatorIndex,
  gloas,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {ErrorAborted, byteArrayEquals, fromHex, toPrintableUrl, toRootHex} from "@lodestar/utils";
import {MAX_BUILDER_BOOST_FACTOR} from "@lodestar/validator";
import {GossipValidationStatus} from "../../../chain/beaconEngine/gossipValidationResult.js";
import {BeaconEngineErrorCode, ProductionResponse} from "../../../chain/beaconEngine/interface.js";
import {BlockInputSource} from "../../../chain/blocks/blockInput/types.js";
import {
  AttestationErrorCode,
  ProposerPreferencesErrorCode,
  SyncCommitteeErrorCode,
} from "../../../chain/errors/index.js";
import {PREPARE_NEXT_SLOT_BPS} from "../../../chain/prepareNextSlot.js";
import {BlockType, ProduceFullGloas, ProduceResult} from "../../../chain/produceBlock/index.js";
import {decodeBuilderUrl} from "../../../execution/builder/apiClient.js";
import {validateGossipFnRetryUnknownRoot} from "../../../network/processor/gossipHandlers.js";
import {CommitteeSubscription} from "../../../network/subnets/index.js";
import {isOptimisticBlock} from "../../../util/forkChoice.js";
import {getBlockGraffiti, toGraffitiBytes} from "../../../util/graffiti.js";
import {getLodestarClientVersion} from "../../../util/metadata.js";
import {getFixedListElementBytes, getVariableListElementBytes} from "../../../util/sszBytes.js";
import {ApiOptions} from "../../options.js";
import {ApiError, FailureList, IndexedError, NodeIsSyncing, OnlySupportedByDVT} from "../errors.js";
import {ApiModules} from "../types.js";
import {notWhileSyncing} from "../utils.js";
import {computeSubnetForCommitteesAtSlot} from "./utils.js";

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
export const SYNC_TOLERANCE_EPOCHS = 1;

export type {BlockSelectionResult} from "../../../chain/beaconEngine/produceEngineOrBuilderBlock.js";
export {
  BuilderBlockSelectionReason,
  EngineBlockSelectionReason,
} from "../../../chain/beaconEngine/produceEngineOrBuilderBlock.js";

/**
 * Server implementation for handling validator duties.
 * See `@lodestar/validator/src/api` for the client implementation).
 */
export function getValidatorApi(
  opts: ApiOptions,
  {chain, config, logger, metrics, network, sync}: ApiModules
): ApplicationMethods<routes.validator.Endpoints> {
  /**
   * Validator clock may be advanced from beacon's clock. If the validator requests a resource in a
   * future slot, wait some time instead of rejecting the request because it's in the future.
   * This value is the same to MAXIMUM_GOSSIP_CLOCK_DISPARITY.
   * For very fast networks, reduce clock disparity to half a slot.
   */
  const MAX_API_CLOCK_DISPARITY_SEC = Math.min(
    config.MAXIMUM_GOSSIP_CLOCK_DISPARITY / 1000,
    config.SLOT_DURATION_MS / 2000
  );
  const MAX_API_CLOCK_DISPARITY_MS = MAX_API_CLOCK_DISPARITY_SEC * 1000;

  /**
   * If advancing the local clock `MAX_API_CLOCK_DISPARITY_MS` ticks to the requested slot, wait for its start
   * Prevents the validator from getting errors from the API if the clock is a bit advanced
   */
  async function waitForSlot(slot: Slot): Promise<void> {
    if (slot <= 0) {
      return;
    }

    const slotStartSec = computeTimeAtSlot(config, slot, chain.genesisTime);
    const msToSlot = slotStartSec * 1000 - Date.now();

    if (msToSlot > MAX_API_CLOCK_DISPARITY_MS) {
      throw Error(`Requested slot ${slot} is in the future`);
    }

    if (msToSlot > 0) {
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
    const nextEpochSlot = computeStartSlotAtEpoch(nextEpoch);
    const nextEpochStartSec = computeTimeAtSlot(config, nextEpochSlot, chain.genesisTime);
    return nextEpochStartSec * 1000 - Date.now();
  }

  function currentEpochWithDisparity(): Epoch {
    return computeEpochAtSlot(getCurrentSlot(config, chain.genesisTime - MAX_API_CLOCK_DISPARITY_SEC));
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
   * 3. ProduceBlock if the parentRoot (chain's current head) is optimistic. Must be checked
   *    explicitly as only local payload production consults the EL, blinded blocks from an
   *    external builder or bid based blocks (gloas) can be produced without a synced EL.
   * 4. SyncCommitteeSignature (base sync committee message) is aborted in the validator client
   *    (see SyncCommitteeService) when the head root it would sign is optimistic, since it is
   *    produced from the head root without a beacon-node produce endpoint to gate here. Spec:
   *    https://github.com/ethereum/consensus-specs/blob/v1.6.1/sync/optimistic.md#participating-in-sync-committees
   */

  function notOnOptimisticBlockRoot(beaconBlockRoot: Root): void {
    const protoBeaconBlock = chain.getBlockDefaultStatus(beaconBlockRoot);
    if (!protoBeaconBlock) {
      throw new ApiError(404, `Block not in forkChoice, beaconBlockRoot=${toRootHex(beaconBlockRoot)}`);
    }

    if (protoBeaconBlock.executionStatus === ExecutionStatus.Syncing)
      throw new NodeIsSyncing(
        `Block's execution payload not yet validated, executionPayloadBlockHash=${protoBeaconBlock.executionPayloadBlockHash} number=${protoBeaconBlock.executionPayloadNumber}`
      );
  }

  function notOnOutOfRangeData(beaconBlockRoot: Root): void {
    const protoBeaconBlock = chain.getBlockDefaultStatus(beaconBlockRoot);
    if (!protoBeaconBlock) {
      throw new ApiError(404, `Block not in forkChoice, beaconBlockRoot=${toRootHex(beaconBlockRoot)}`);
    }

    if (protoBeaconBlock.dataAvailabilityStatus === DataAvailabilityStatus.OutOfRange)
      throw new NodeIsSyncing("Block's data is out of range and not validated");
  }

  // [beacon-engine] moved: produceEngineOrBuilderBlock, produceBuilderBlindedBlock,
  // produceEngineBlockContents, and getBlockValueLogInfo now live in
  // packages/beacon-node/src/chain/beaconEngine/produceEngineOrBuilderBlock.ts under the same names.
  // On unstable merges, apply changes to those implementations there; retain API-only work here.

  function unwrapProductionResult<T>(result: ProductionResponse<T>): T {
    if (result.ok) return result.data;
    switch (result.code) {
      case BeaconEngineErrorCode.API_ERROR:
        throw new ApiError(result.payload.status, result.payload.message);
      case BeaconEngineErrorCode.NODE_SYNCING:
        throw new NodeIsSyncing(result.payload.message);
      case BeaconEngineErrorCode.ABORTED:
        throw new ErrorAborted(result.payload.message.replace(/^Aborted /, ""));
      case BeaconEngineErrorCode.INTERNAL:
        throw Error(result.payload.message);
    }
  }

  function cacheProducedBlock(
    block: BeaconBlock | BlindedBeaconBlock,
    produceResult: ProduceResult,
    source: ProducedBlockSource
  ): void {
    const root =
      produceResult.type === BlockType.Full
        ? config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block as BeaconBlock)
        : config.getPostBellatrixForkTypes(block.slot).BlindedBeaconBlock.hashTreeRoot(block as BlindedBeaconBlock);
    chain.blockProductionCache.set(toRootHex(root), produceResult);
    metrics?.blockProductionCacheSize.set(chain.blockProductionCache.size);
    if (chain.opts.persistProducedBlocks) {
      void chain.persistBlock(
        block,
        source === ProducedBlockSource.builder ? "produced_builder_block" : "produced_engine_block"
      );
    }
  }

  return {
    // [beacon-engine] moved: the production race runs through BeaconEngine.produceBlock in
    // packages/beacon-node/src/chain/beaconEngine/produceEngineOrBuilderBlock.ts#produceEngineOrBuilderBlock.
    // On unstable merges, sync race/helper changes there and API wrapper changes here.
    async produceBlockV3({
      slot,
      randaoReveal,
      graffiti,
      skipRandaoVerification: _skipRandaoVerification,
      builderBoostFactor,
      ...productionOpts
    }) {
      const forkName = config.getForkName(slot);
      if (isForkPostGloas(forkName)) {
        throw new ApiError(400, `produceBlockV3 not supported for post-gloas fork=${forkName}, use produceBlockV4`);
      }
      notWhileSyncing(chain, sync.state);
      await waitForSlot(slot);
      if (builderBoostFactor !== undefined && builderBoostFactor > MAX_BUILDER_BOOST_FACTOR) {
        throw new ApiError(400, `Invalid builderBoostFactor=${builderBoostFactor} > MAX_BUILDER_BOOST_FACTOR`);
      }
      const result = await chain.beaconEngine.produceBlock({
        slot,
        randaoReveal,
        graffiti: toGraffitiBytes(
          getBlockGraffiti(graffiti, getLodestarClientVersion(opts), chain.executionEngine.clientVersion, {
            private: opts.private,
            graffitiAppend: chain.opts.graffitiAppend,
          })
        ),
        feeRecipient: productionOpts.feeRecipient,
        strictFeeRecipientCheck: productionOpts.strictFeeRecipientCheck,
        builderSelection: productionOpts.builderSelection ?? routes.validator.BuilderSelection.MaxProfit,
        builderBoostFactor: builderBoostFactor ?? BigInt(100),
      });
      const {data, produceResult, ...meta} = unwrapProductionResult(result);
      cacheProducedBlock(
        meta.executionPayloadBlinded ? (data as BlindedBeaconBlock) : (data as BlockContents).block,
        produceResult,
        meta.executionPayloadSource
      );

      const fork = ForkSeq[meta.version];
      if (productionOpts.blindedLocal === true && fork >= ForkSeq.bellatrix && fork < ForkSeq.gloas) {
        if (meta.executionPayloadBlinded) {
          return {data, meta};
        }

        const {block} = data as BlockContents;
        const blindedBlock = beaconBlockToBlinded(config, block as BeaconBlock<ForkPostBellatrix & ForkPreGloas>);
        return {
          data: blindedBlock,
          meta: {...meta, executionPayloadBlinded: true},
        };
      }

      return {data, meta};
    },

    async produceBlockV4({
      slot,
      randaoReveal,
      graffiti,
      feeRecipient,
      strictFeeRecipientCheck,
      includePayload,
      builderConfig,
    }) {
      const fork = config.getForkName(slot);

      if (!isForkPostGloas(fork)) {
        throw new ApiError(400, `produceBlockV4 not supported for pre-gloas fork=${fork}`);
      }

      const builderBoostFactor = builderConfig.builderBoostFactor;
      if (builderBoostFactor > MAX_BUILDER_BOOST_FACTOR) {
        throw new ApiError(400, `Invalid builderBoostFactor=${builderBoostFactor} > MAX_BUILDER_BOOST_FACTOR`);
      }

      notWhileSyncing(chain, sync.state);
      await waitForSlot(slot);

      const graffitiBytes = toGraffitiBytes(
        getBlockGraffiti(graffiti, getLodestarClientVersion(opts), chain.executionEngine.clientVersion, {
          private: opts.private,
          graffitiAppend: chain.opts.graffitiAppend,
        })
      );

      const result = await chain.beaconEngine.produceBlockV4({
        slot,
        randaoReveal,
        graffiti: graffitiBytes,
        feeRecipient,
        strictFeeRecipientCheck,
        includePayload,
        builderConfig,
      });
      const {data, meta, produceResult, executionPayloadSource} = unwrapProductionResult(result);
      if (chain.opts.persistProducedPayloadEnvelopes && "executionPayloadEnvelope" in data) {
        chain.persistExecutionPayloadEnvelope(data.executionPayloadEnvelope);
      }
      cacheProducedBlock("block" in data ? data.block : data, produceResult, executionPayloadSource);
      return {data, meta};
    },

    async produceAttestationData({committeeIndex, slot}) {
      notWhileSyncing(chain, sync.state);

      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      // This needs a state in the same epoch as `slot` such that state.currentJustifiedCheckpoint is correct.
      // Note: This may trigger an epoch transition if there skipped slots at the beginning of the epoch.
      const head = chain.getHead();
      const headSlot = head.slot;
      const attEpoch = computeEpochAtSlot(slot);
      const headBlockRoot = fromHex(head.blockRoot);
      const fork = config.getForkName(slot);

      // Canonical block root ≤ slot (matches the former state.getBlockRootAtSlot; handles skipped slots).
      const blockRootAtSlot = (atSlot: Slot): Root => {
        const canonical = chain.getCanonicalBlockClosestLteSlot(atSlot);
        if (!canonical) {
          throw Error(`No canonical block found for slot=${atSlot}`);
        }
        return fromHex(canonical.blockRoot);
      };

      const beaconBlockRoot =
        slot >= headSlot
          ? // When attesting to the head slot or later, always use the head of the chain.
            headBlockRoot
          : // Permit attesting to slots *prior* to the current head. This is desirable when
            // the VC and BN are out-of-sync due to time issues or overloading.
            blockRootAtSlot(slot);

      let index: CommitteeIndex;
      if (isForkPostGloas(fork)) {
        const canonicalBlock = chain.getCanonicalBlockByRoot(beaconBlockRoot);
        if (!canonicalBlock) {
          // This should never happen
          throw Error(`Block not found in fork choice for slot=${slot}, root=${toRootHex(beaconBlockRoot)}`);
        }
        // After Gloas, attestation.data.index signals payload status in fork-choice:
        // - 0 = EMPTY / not present, 1 = FULL / present
        // - same-slot attestations must always use index = 0
        if (canonicalBlock.slot !== slot) {
          index = canonicalBlock.payloadStatus === PayloadStatus.FULL ? 1 : 0;
        } else {
          index = 0;
        }
      } else if (isForkPostElectra(fork)) {
        index = 0;
      } else {
        if (committeeIndex === undefined) {
          throw new ApiError(400, `Committee index must be provided for pre-electra fork=${fork}`);
        }
        index = committeeIndex;
      }

      const targetSlot = computeStartSlotAtEpoch(attEpoch);
      const targetRoot =
        targetSlot >= headSlot
          ? // If the state is earlier than the target slot then the target *must* be the head block root.
            headBlockRoot
          : blockRootAtSlot(targetSlot);

      // Check the execution status as validator shouldn't vote on an optimistic head
      // Check on target is sufficient as a valid target would imply a valid source
      notOnOptimisticBlockRoot(targetRoot);
      notOnOutOfRangeData(targetRoot);

      // To get the correct source we must get a state in the same epoch as the attestation's epoch.
      // An epoch transition may change state.currentJustifiedCheckpoint (resolved inside the engine).
      const source = await chain.beaconEngine.getAttestationSourceCheckpoint(attEpoch);

      return {
        data: {
          slot,
          index,
          beaconBlockRoot,
          source,
          target: {epoch: attEpoch, root: targetRoot},
        },
      };
    },

    async producePayloadAttestationData({slot}) {
      const fork = config.getForkName(slot);
      if (!isForkPostGloas(fork)) {
        throw new ApiError(400, `producePayloadAttestationData is not supported before Gloas fork=${fork}`);
      }

      notWhileSyncing(chain, sync.state);
      await waitForSlot(slot);

      const block = chain.getCanonicalProtoBlockAtSlot(slot);
      if (!block) {
        // No canonical block is seen at slot. Return 204 so vc can skip casting payload attestation.
        return {data: undefined, meta: {version: fork}, status: 204};
      }

      const payloadInput = chain.seenPayloadEnvelopeInputCache.get(block.blockRoot);
      // Spec: set payload_present only if the envelope was seen before get_payload_due_ms()
      // into the slot. Use the envelope's own arrival time (getPayloadEnvelopeSource), not
      // the input's creation time.
      const payloadDueSec = config.getPayloadDueMs(fork) / 1000;
      const payloadSeenSec =
        payloadInput?.hasPayloadEnvelope() === true
          ? chain.clock.secFromSlot(slot, payloadInput.getPayloadEnvelopeSource().seenTimestampSec)
          : null;
      const payloadPresent = payloadSeenSec !== null && payloadSeenSec < payloadDueSec;
      const blobDataAvailable = payloadInput?.hasAllData() === true;

      logger.debug("Produced payload attestation data", {
        slot,
        blockRoot: block.blockRoot,
        blockSlot: block.slot,
        payloadPresent,
        blobDataAvailable,
        hasPayloadInput: payloadInput !== undefined,
        payloadSeenSec,
        payloadDueSec,
      });

      return {
        data: {
          beaconBlockRoot: fromHex(block.blockRoot),
          slot,
          payloadPresent,
          blobDataAvailable,
        },
        meta: {version: fork},
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
    async produceSyncCommitteeContribution({slot, subcommitteeIndex, beaconBlockRoot}) {
      // when a validator is configured with multiple beacon node urls, this beaconBlockRoot may come from another beacon node
      // and it hasn't been in our forkchoice since we haven't seen / processing that block
      // see https://github.com/ChainSafe/lodestar/issues/5063
      if (!chain.hasBlock(beaconBlockRoot)) {
        const rootHex = toRootHex(beaconBlockRoot);
        network.searchUnknownBlock({slot, root: rootHex}, BlockInputSource.api);
        // if result of this call is false, i.e. block hasn't seen after 1 slot then the below notOnOptimisticBlockRoot call will throw error
        await chain.waitForBlock(slot, rootHex);
      }

      // Check the execution status as validator shouldn't contribute on an optimistic head
      notOnOptimisticBlockRoot(beaconBlockRoot);
      notOnOutOfRangeData(beaconBlockRoot);

      const contribution = await chain.beaconEngine.getSyncCommitteeContribution(
        subcommitteeIndex,
        slot,
        beaconBlockRoot
      );
      if (!contribution) {
        throw new ApiError(
          404,
          `No sync committee contribution for slot=${slot}, subnet=${subcommitteeIndex}, beaconBlockRoot=${toRootHex(beaconBlockRoot)}`
        );
      }

      metrics?.production.producedSyncContributionParticipants.observe(
        contribution.aggregationBits.getTrueBitIndexes().length
      );

      return {data: contribution};
    },

    async getProposerDuties({epoch}, _context, opts?: {v2?: boolean}) {
      notWhileSyncing(chain, sync.state);

      const currentEpoch = currentEpochWithDisparity();
      const nextEpoch = currentEpoch + 1;
      const startSlot = computeStartSlotAtEpoch(epoch);
      const prepareFork = config.getForkName(computeStartSlotAtEpoch(nextEpoch) - 1);
      const prepareNextSlotLookAheadMs =
        config.getSlotDurationMs(prepareFork) - config.getSlotComponentDurationMs(prepareFork, PREPARE_NEXT_SLOT_BPS);
      const toNextEpochMs = msToNextEpoch();
      const nearNextEpoch = toNextEpochMs < prepareNextSlotLookAheadMs;
      // Post-Fulu the proposer lookahead is deterministic and known a full epoch ahead, so
      // close to the boundary `currentEpoch + 2` is serveable from the upcoming-epoch
      // checkpoint state (its `nextProposers`). Pre-Fulu / mid-epoch: `currentEpoch + 1` max.
      const isPostFulu = isForkPostFulu(config.getForkName(startSlot));
      const maxFutureEpoch = isPostFulu && nearNextEpoch && opts?.v2 ? nextEpoch + 1 : nextEpoch;
      if (currentEpoch >= 0 && epoch > maxFutureEpoch) {
        throw new ApiError(
          400,
          `Requested epoch ${epoch} must not be more than ${maxFutureEpoch}, currentEpoch=${currentEpoch}, v2=${opts?.v2 ?? false}`
        );
      }

      // near the boundary, let the engine wait briefly for the next-epoch checkpoint state so the
      // upcoming epoch's duties can be served early. The clock deadline (wait until slot 1 of the next
      // epoch, the validator-api timeout) is passed in as a relative duration — the engine holds no clock.
      const checkpointWaitTimeoutMs =
        nearNextEpoch && (epoch === nextEpoch || (isPostFulu && epoch === nextEpoch + 1))
          ? computeTimeAtSlot(config, computeStartSlotAtEpoch(nextEpoch) + 1, chain.genesisTime) * 1000 - Date.now()
          : undefined;

      const {data, dependentRoot, head} = await chain.beaconEngine.getProposerDuties(
        epoch,
        {currentEpoch, checkpointWaitTimeoutMs},
        opts?.v2 ?? false
      );

      return {
        data,
        meta: {
          dependentRoot: toRootHex(dependentRoot),
          executionOptimistic: isOptimisticBlock(head),
        },
      };
    },

    async getProposerDutiesV2(args, context) {
      return this.getProposerDuties(args, context, {v2: true});
    },

    async getAttesterDuties({epoch, indices}) {
      notWhileSyncing(chain, sync.state);

      if (indices.length === 0) {
        throw new ApiError(400, "No validator to get attester duties");
      }

      // May request for an epoch that's in the future
      await waitForNextClosestEpoch();

      // should not compare to headEpoch in order to handle skipped slots
      // Check if the epoch is in the future after waiting for requested slot
      if (epoch > chain.clock.currentEpoch + 1) {
        throw new ApiError(400, "Cannot get duties for epoch more than one ahead");
      }

      const {data, dependentRoot, head} = await chain.beaconEngine.getAttesterDuties(
        epoch,
        indices,
        chain.clock.currentEpoch
      );

      return {
        data,
        meta: {
          dependentRoot: toRootHex(dependentRoot),
          executionOptimistic: isOptimisticBlock(head),
        },
      };
    },

    async getPtcDuties({epoch, indices}) {
      notWhileSyncing(chain, sync.state);

      if (indices.length === 0) {
        throw new ApiError(400, "No validator to get PTC duties");
      }

      const startSlot = computeStartSlotAtEpoch(epoch);
      const fork = config.getForkName(startSlot);
      if (!isForkPostGloas(fork)) {
        throw new ApiError(400, `PTC duties are not supported before Gloas fork=${fork}`);
      }

      await waitForNextClosestEpoch();

      if (epoch > chain.clock.currentEpoch + 1) {
        throw new ApiError(400, "Cannot get PTC duties for epoch more than one ahead");
      }

      const {data, dependentRoot, head} = await chain.beaconEngine.getPtcDuties(
        epoch,
        indices,
        chain.clock.currentEpoch
      );

      return {
        data,
        meta: {
          dependentRoot: toRootHex(dependentRoot),
          executionOptimistic: isOptimisticBlock(head),
        },
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
    async getSyncCommitteeDuties({epoch, indices}) {
      notWhileSyncing(chain, sync.state);

      if (indices.length === 0) {
        throw new ApiError(400, "No validator to get attester duties");
      }
      if (epoch < config.ALTAIR_FORK_EPOCH) {
        throw new ApiError(400, "Sync committee duties are not supported before Altair");
      }

      // May request for an epoch that's in the future
      await waitForNextClosestEpoch();

      // sync committee duties have a lookahead of 1 day. Assuming the validator only requests duties for upcoming
      // epochs, the head state will very likely have the duties available for the requested epoch.
      // Note: does not support requesting past duties
      const {data, head} = await chain.beaconEngine.getSyncCommitteeDuties(epoch, indices);

      return {
        data,
        meta: {executionOptimistic: isOptimisticBlock(head)},
      };
    },

    async getAggregatedAttestationV2({attestationDataRoot, slot, committeeIndex}) {
      notWhileSyncing(chain, sync.state);

      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      const dataRootHex = toRootHex(attestationDataRoot);
      const aggregate = await chain.beaconEngine.getAttestationAggregate(slot, dataRootHex, committeeIndex);

      if (!aggregate) {
        throw new ApiError(
          404,
          `No aggregated attestation for slot=${slot}, dataRoot=${dataRootHex}, committeeIndex=${committeeIndex}`
        );
      }

      metrics?.production.producedAggregateParticipants.observe(aggregate.aggregationBits.getTrueBitIndexes().length);

      return {
        data: aggregate,
        meta: {version: config.getForkName(slot)},
      };
    },

    async publishAggregateAndProofsV2({signedAggregateAndProofs}, context) {
      notWhileSyncing(chain, sync.state);

      const seenTimestampSec = Date.now() / 1000;
      const failures: FailureList = [];
      const fork = chain.config.getForkName(chain.clock.currentSlot);

      // SSZ request: slice each aggregate out of the (variable-size element) list body. JSON request
      // (no sszBytes): serialize once. Never re-serialize on the SSZ path.
      const aggregateBytes = context?.sszBytes
        ? getVariableListElementBytes(context.sszBytes)
        : signedAggregateAndProofs.map((agg) => sszTypesFor(fork).SignedAggregateAndProof.serialize(agg));

      await Promise.all(
        signedAggregateAndProofs.map(async (signedAggregateAndProof, i) => {
          const logCtx = {
            slot: signedAggregateAndProof.message.aggregate.data.slot,
            index: signedAggregateAndProof.message.aggregate.data.index,
          };
          try {
            // TODO: Validate in batch
            const validateFn = () =>
              chain.beaconEngine.validateApiAggregateAndProof(aggregateBytes[i], fork, signedAggregateAndProof);
            const {slot, beaconBlockRoot} = signedAggregateAndProof.message.aggregate.data;
            // when a validator is configured with multiple beacon node urls, this attestation may come from another beacon node
            // and the block hasn't been in our forkchoice since we haven't seen / processing that block
            // see https://github.com/ChainSafe/lodestar/issues/5098
            const res = await validateGossipFnRetryUnknownRoot(validateFn, network, chain, slot, beaconBlockRoot);
            if (res.err !== null) {
              if (res.err.code === AttestationErrorCode.AGGREGATOR_ALREADY_KNOWN) {
                logger.debug("Ignoring known signedAggregateAndProof", logCtx);
                return; // Ok to submit the same aggregate twice
              }
              failures.push({index: i, message: res.err.error?.message ?? res.err.code});
              logger.verbose(`Error on publishAggregateAndProofs [${i}]`, logCtx, res.err.error);
              if (res.err.status === GossipValidationStatus.Reject) {
                chain.persistInvalidSszValue(ssz.phase0.SignedAggregateAndProof, signedAggregateAndProof, "api_reject");
              }
              return;
            }
            const {indexedAttestation} = res.result;

            const sentPeers = await network.publishBeaconAggregateAndProof(signedAggregateAndProof);
            await chain.beaconEngine.onPoolSubmitAggregatedAttestation(
              seenTimestampSec,
              {
                attestingIndices: indexedAttestation.attestingIndices,
                data: {
                  slot: indexedAttestation.data.slot,
                  index: indexedAttestation.data.index,
                  target: indexedAttestation.data.target,
                },
              },
              sentPeers
            );
          } catch (e) {
            failures.push({index: i, message: (e as Error).message});
            logger.verbose(`Error on publishAggregateAndProofs [${i}]`, logCtx, e as Error);
          }
        })
      );

      if (failures.length > 0) {
        throw new IndexedError("Error processing aggregate and proofs", failures);
      }
    },

    /**
     * POST `/eth/v1/validator/contribution_and_proofs`
     *
     * Publish multiple signed sync committee contribution and proofs
     *
     * https://github.com/ethereum/beacon-APIs/pull/137
     */
    async publishContributionAndProofs({contributionAndProofs}, context) {
      notWhileSyncing(chain, sync.state);

      const failures: FailureList = [];

      // SSZ request: slice each entry out of the (fixed-size element) list body. JSON request
      // (no sszBytes): serialize once.
      const contributionBytes = context?.sszBytes
        ? getFixedListElementBytes(context.sszBytes, ssz.altair.SignedContributionAndProof.fixedSize)
        : contributionAndProofs.map((c) => ssz.altair.SignedContributionAndProof.serialize(c));

      await Promise.all(
        contributionAndProofs.map(async (contributionAndProof, i) => {
          const logCtx = {
            slot: contributionAndProof.message.contribution.slot,
            subcommitteeIndex: contributionAndProof.message.contribution.subcommitteeIndex,
          };
          try {
            // TODO: Validate in batch
            // Engine validates (skipping the known-participants check) + inserts into its (internal) pool on Accept.
            const res = await chain.beaconEngine.validateApiSyncCommitteeContributionAndProof(
              contributionBytes[i],
              contributionAndProof
            );
            if (res.err !== null) {
              if (res.err.code === SyncCommitteeErrorCode.SYNC_COMMITTEE_AGGREGATOR_ALREADY_KNOWN) {
                logger.debug("Ignoring known contributionAndProof", logCtx);
                return; // Ok to submit the same aggregate twice
              }
              failures.push({index: i, message: res.err.error?.message ?? res.err.code});
              logger.verbose(`Error on publishContributionAndProofs [${i}]`, logCtx, res.err.error);
              if (res.err.status === GossipValidationStatus.Reject) {
                chain.persistInvalidSszValue(ssz.altair.SignedContributionAndProof, contributionAndProof, "api_reject");
              }
              return;
            }
            await network.publishContributionAndProof(contributionAndProof);
          } catch (e) {
            failures.push({index: i, message: (e as Error).message});
            logger.verbose(`Error on publishContributionAndProofs [${i}]`, logCtx, e as Error);
          }
        })
      );

      if (failures.length > 0) {
        throw new IndexedError("Error processing contribution and proofs", failures);
      }
    },

    async prepareBeaconCommitteeSubnet({subscriptions}) {
      // The subscribing validators use this node for duties regardless of its sync state and
      // the subscription must not fail on the tracking, e.g. if the finalized state is unavailable
      try {
        await chain.updateAttachedValidators(
          chain.clock.currentEpoch,
          Array.from(new Set(subscriptions.map(({validatorIndex}) => validatorIndex)))
        );
      } catch (e) {
        logger.warn("Error tracking attached validators", {count: subscriptions.length}, e as Error);
      }

      notWhileSyncing(chain, sync.state);

      const committeeSubscriptions = subscriptions.map(
        ({validatorIndex, slot, isAggregator, committeesAtSlot, committeeIndex}) => ({
          validatorIndex: validatorIndex,
          subnet: computeSubnetForCommitteesAtSlot(slot, committeesAtSlot, committeeIndex),
          slot: slot,
          isAggregator: isAggregator,
        })
      );
      await chain.beaconEngine.prepareBeaconCommitteeSubnets(committeeSubscriptions);
      await network.prepareBeaconCommitteeSubnets(committeeSubscriptions);

      // TODO:
      // If the discovery mechanism isn't disabled, attempt to set up a peer discovery for the
      // required subnets.

      if (metrics) {
        await chain.beaconEngine.registerLocalValidators(subscriptions.map(({validatorIndex}) => validatorIndex));
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
    async prepareSyncCommitteeSubnets({subscriptions}) {
      notWhileSyncing(chain, sync.state);

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
        await chain.beaconEngine.registerLocalValidatorsInSyncCommittee(
          subscriptions.map(({validatorIndex, untilEpoch}) => ({validatorIndex, untilEpoch}))
        );
      }
    },

    async prepareBeaconProposer({proposers}) {
      if (isForkPostGloas(config.getForkName(chain.clock.currentSlot))) {
        throw new ApiError(
          410,
          "prepareBeaconProposer is no longer supported from gloas, submit signed proposer preferences via POST /eth/v1/validator/proposer_preferences instead"
        );
      }

      await chain.updateBeaconProposerData(chain.clock.currentEpoch, proposers);
    },

    async submitBeaconCommitteeSelections() {
      throw new OnlySupportedByDVT();
    },

    async submitSyncCommitteeSelections() {
      throw new OnlySupportedByDVT();
    },

    async getLiveness({epoch, indices}) {
      if (indices.length === 0) {
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
        data: await Promise.all(
          indices.map(async (index) => ({
            index,
            isLive: await chain.validatorSeenAtEpoch(index, epoch),
          }))
        ),
      };
    },

    async registerValidator({registrations}) {
      if (isForkPostGloas(config.getForkName(chain.clock.currentSlot))) {
        throw new ApiError(
          410,
          "registerValidator is no longer supported from gloas, submit builder preferences via POST /eth/v1/validator/builder_preferences instead"
        );
      }

      // should only send active or pending validator to builder
      // Spec: https://ethereum.github.io/builder-specs/#/Builder/registerValidator
      const currentEpoch = chain.clock.currentEpoch;

      // Resolve pubkey→index facade-side (shared pubkeyCache); the engine returns which are active/pending.
      const withIndex: {registration: (typeof registrations)[number]; index: ValidatorIndex}[] = [];
      for (const registration of registrations) {
        const index = chain.pubkeyCache.getIndex(registration.message.pubkey);
        if (index !== null) {
          withIndex.push({registration, index});
        }
      }
      const activeOrPending = await chain.beaconEngine.getActiveOrPendingValidators(withIndex.map((x) => x.index));
      const filteredRegistrations = withIndex.filter((x) => activeOrPending.has(x.index)).map((x) => x.registration);

      const registrationsBytes =
        routes.validator.SignedValidatorRegistrationV1ListType.serialize(filteredRegistrations);
      await chain.beaconEngine.registerValidator(currentEpoch, registrationsBytes, filteredRegistrations);

      logger.debug("Forwarded validator registrations to connected builder", {
        epoch: currentEpoch,
        count: filteredRegistrations.length,
      });
    },

    async submitProposerPreferences({signedProposerPreferences}, context) {
      const failures: FailureList = [];
      // Preferences submitted here are signed by validators using this node, gossiped ones are not
      const attachedValidatorIndices: ValidatorIndex[] = [];

      // SSZ request: slice each entry out of the (fixed-size element) list body. JSON request
      // (no sszBytes): serialize once.
      const preferencesBytes = context?.sszBytes
        ? getFixedListElementBytes(context.sszBytes, ssz.gloas.SignedProposerPreferences.fixedSize)
        : signedProposerPreferences.map((s) => ssz.gloas.SignedProposerPreferences.serialize(s));

      await Promise.all(
        signedProposerPreferences.map(async (signed, i) => {
          const logCtx = {
            slot: signed.message.proposalSlot,
            validatorIndex: signed.message.validatorIndex,
            dependentRoot: toRootHex(signed.message.dependentRoot),
          };
          try {
            const res = await chain.beaconEngine.validateGossipProposerPreferences(preferencesBytes[i], signed);
            if (res.err !== null) {
              if (res.err.code === ProposerPreferencesErrorCode.ALREADY_KNOWN) {
                attachedValidatorIndices.push(signed.message.validatorIndex);
                logger.debug("Ignoring known signed proposer preferences", logCtx);
                return;
              }
              failures.push({index: i, message: res.err.error?.message ?? res.err.code});
              logger.verbose(`Error on submitProposerPreferences [${i}]`, logCtx, res.err.error);
              if (res.err.status === GossipValidationStatus.Reject) {
                chain.persistInvalidSszValue(ssz.gloas.SignedProposerPreferences, signed, "api_reject");
              }
              return;
            }

            attachedValidatorIndices.push(signed.message.validatorIndex);
            // Engine inserted into its (internal) proposerPreferencesPool on Accept above.
            await network.publishProposerPreferences(signed);
            chain.emitter.emit(routes.events.EventType.proposerPreferences, {
              version: ForkName.gloas,
              data: signed,
            });
          } catch (e) {
            failures.push({index: i, message: (e as Error).message});
            logger.verbose(`Error on submitProposerPreferences [${i}]`, logCtx, e as Error);
          }
        })
      );

      if (attachedValidatorIndices.length > 0) {
        try {
          await chain.updateAttachedValidators(chain.clock.currentEpoch, attachedValidatorIndices);
        } catch (e) {
          logger.warn("Error tracking attached validators", {count: attachedValidatorIndices.length}, e as Error);
        }
      }

      if (failures.length > 0) {
        throw new IndexedError("Error processing signed proposer preferences", failures);
      }
    },

    async submitBuilderPreferences({builderPreferences}) {
      const failures: FailureList = [];

      await Promise.all(
        builderPreferences.map(async (entry, i) => {
          let builder = Buffer.from(entry.url).toString("utf8");
          try {
            const url = decodeBuilderUrl(entry.url);
            builder = toPrintableUrl(url);
            const expectedProposerPubkey = await chain.beaconEngine.getHeadProposerPubkey(entry.auth.message.slot);
            if (!byteArrayEquals(entry.proposerPubkey, expectedProposerPubkey)) {
              throw new ApiError(
                400,
                `Invalid proposer pubkey for builder preferences slot=${entry.auth.message.slot}`
              );
            }
            await chain.builderApiClient.submitBuilderPreferences(url, entry.proposerPubkey, {
              preferences: {maxExecutionPayment: entry.maxExecutionPayment},
              auth: entry.auth,
            });
          } catch (e) {
            failures.push({index: i, message: `${builder}: ${(e as Error).message}`});
            logger.verbose(
              `Error on submitBuilderPreferences [${i}]`,
              {slot: entry.auth.message.slot, builder},
              e as Error
            );
          }
        })
      );

      if (failures.length > 0) {
        throw new IndexedError("Error submitting builder preferences", failures);
      }
    },

    async getExecutionPayloadEnvelope({slot, beaconBlockRoot}) {
      const fork = config.getForkName(slot);

      if (!isForkPostGloas(fork)) {
        throw new ApiError(400, `getExecutionPayloadEnvelope not supported for pre-gloas fork=${fork}`);
      }

      notWhileSyncing(chain, sync.state);
      await waitForSlot(slot);

      const blockRootHex = toRootHex(beaconBlockRoot);
      const produceResult = chain.blockProductionCache.get(blockRootHex);

      if (produceResult === undefined) {
        throw new ApiError(404, `No cached block production result found for block root ${blockRootHex}`);
      }
      if (!isForkPostGloas(produceResult.fork)) {
        throw Error(`Cached block production result is for pre-gloas fork=${produceResult.fork}`);
      }
      if (produceResult.type !== BlockType.Full) {
        throw Error("Cached block production result is not full block");
      }

      const {executionPayload, executionRequests, parentBlockRoot} = produceResult as ProduceFullGloas;

      if (executionPayload === undefined) {
        // Blocks committing to a builder bid are cached as full but without payload data
        throw new ApiError(404, `No local execution payload cached for block root ${blockRootHex}`);
      }

      if (executionPayload.slotNumber !== slot) {
        throw new ApiError(
          404,
          `Cached execution payload is for slot=${executionPayload.slotNumber}, requested slot=${slot}`
        );
      }

      const envelope: gloas.ExecutionPayloadEnvelope = {
        payload: executionPayload,
        executionRequests: executionRequests,
        builderIndex: BUILDER_INDEX_SELF_BUILD,
        beaconBlockRoot,
        parentBeaconBlockRoot: parentBlockRoot,
      };

      logger.info("Produced execution payload envelope", {
        slot,
        blockRoot: blockRootHex,
        transactions: executionPayload.transactions.length,
        blockHash: toRootHex(executionPayload.blockHash),
      });

      if (chain.opts.persistProducedPayloadEnvelopes) {
        chain.persistExecutionPayloadEnvelope(envelope);
      }

      return {
        data: envelope,
        meta: {
          version: fork,
        },
      };
    },
  };
}
