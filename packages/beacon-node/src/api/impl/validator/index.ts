import {fromHexString} from "@chainsafe/ssz";
import {ServerApi, routes} from "@lodestar/api";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {GENESIS_SLOT, SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getCurrentSlot,
} from "@lodestar/state-transition";
import {Epoch, Root, Slot, phase0, ssz} from "@lodestar/types";
import {ChainEvent, CheckpointHex} from "../../../chain/index.js";
import {ZERO_HASH} from "../../../constants/index.js";
import {SyncState} from "../../../sync/index.js";
import {ApiError, NodeIsSyncing} from "../errors.js";
import {ApiModules} from "../types.js";
import {buildGetAggregatedAttestation} from "./endpoints/getAggregatedAttestation.js";
import {buildGetAttesterDuties} from "./endpoints/getAttesterDuties.js";
import {buildGetLiveness} from "./endpoints/getLiveness.js";
import {buildGetProposerDuties} from "./endpoints/getProposerDuties.js";
import {buildGetSyncCommitteeDuties} from "./endpoints/getSyncCommitteeDuties.js";
import {buildPrepareBeaconCommitteeSubnet} from "./endpoints/prepareBeaconCommitteeSubnet.js";
import {buildPrepareBeaconProposer} from "./endpoints/prepareBeaconProposer.js";
import {buildPrepareSyncCommitteeSubnets} from "./endpoints/prepareSyncCommitteeSubnets.js";
import {buildProduceAttestationData} from "./endpoints/produceAttestationData.js";
import {buildProduceBlindedBlock} from "./endpoints/produceBlindedBlock.js";
import {buildProduceBlock} from "./endpoints/produceBlock.js";
import {buildProduceBlockV2} from "./endpoints/produceBlockV2.js";
import {buildProduceBlockV3} from "./endpoints/produceBlockV3.js";
import {buildProduceSyncCommitteeContribution} from "./endpoints/produceSyncCommitteeContribution.js";
import {buildPublishAggregateAndProofs} from "./endpoints/publishAggregateAndProofs.js";
import {buildPublishContributionAndProofs} from "./endpoints/publishContributionAndProofs.js";
import {buildRegisterValidator} from "./endpoints/registerValidator.js";
import {buildSubmitBeaconCommitteeSelections} from "./endpoints/submitBeaconCommitteeSelections.js";
import {buildSubmitSyncCommitteeSelections} from "./endpoints/submitSyncCommitteeSelections.js";
import {ValidatorEndpointDependencies} from "./endpoints/types.js";

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
const SYNC_TOLERANCE_EPOCHS = 1;

/**
 * Server implementation for handling validator duties.
 * See `@lodestar/validator/src/api` for the client implementation).
 */
export function getValidatorApi(modules: ApiModules): ServerApi<routes.validator.Api> {
  const {chain, config, sync} = modules;
  let genesisBlockRoot: Root | null = null;

  /**
   * Validator clock may be advanced from beacon's clock. If the validator requests a resource in a
   * future slot, wait some time instead of rejecting the request because it's in the future.
   * This value is the same to MAXIMUM_GOSSIP_CLOCK_DISPARITY_SEC.
   * For very fast networks, reduce clock disparity to half a slot.
   */
  const MAX_API_CLOCK_DISPARITY_SEC = Math.min(0.5, config.SECONDS_PER_SLOT / 2);
  const MAX_API_CLOCK_DISPARITY_MS = MAX_API_CLOCK_DISPARITY_SEC * 1000;

  /** Compute and cache the genesis block root */
  async function getGenesisBlockRoot(state: CachedBeaconStateAllForks): Promise<Root> {
    if (!genesisBlockRoot) {
      // Close to genesis the genesis block may not be available in the DB
      if (state.slot < SLOTS_PER_HISTORICAL_ROOT) {
        genesisBlockRoot = state.blockRoots.get(0);
      }

      const blockRes = await chain.getCanonicalBlockAtSlot(GENESIS_SLOT);
      if (blockRes) {
        genesisBlockRoot = config
          .getForkTypes(blockRes.block.message.slot)
          .SignedBeaconBlock.hashTreeRoot(blockRes.block);
      }
    }

    // If for some reason the genesisBlockRoot is not able don't prevent validators from
    // proposing or attesting. If the genesisBlockRoot is wrong, at worst it may trigger a re-fetch of the duties
    return genesisBlockRoot || ZERO_HASH;
  }

  /**
   * If advancing the local clock `MAX_API_CLOCK_DISPARITY_MS` ticks to the requested slot, wait for its start
   * Prevents the validator from getting errors from the API if the clock is a bit advanced
   */
  async function waitForSlot(slot: Slot): Promise<void> {
    if (slot <= 0) {
      return;
    }

    const slotStartSec = chain.genesisTime + slot * config.SECONDS_PER_SLOT;
    const msToSlot = slotStartSec * 1000 - Date.now();

    if (msToSlot > MAX_API_CLOCK_DISPARITY_MS) {
      throw Error(`Requested slot ${slot} is in the future`);
    } else if (msToSlot > 0) {
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
    const secPerEpoch = SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT;
    const nextEpochStartSec = chain.genesisTime + nextEpoch * secPerEpoch;
    return nextEpochStartSec * 1000 - Date.now();
  }

  function currentEpochWithDisparity(): Epoch {
    return computeEpochAtSlot(getCurrentSlot(config, chain.genesisTime - MAX_API_CLOCK_DISPARITY_SEC));
  }

  /**
   * This function is called 1s before next epoch, usually at that time PrepareNextSlotScheduler finishes
   * so we should have checkpoint state, otherwise wait for up to the slot 1 of epoch.
   *      slot epoch        0            1
   *           |------------|------------|
   *                    ^  ^
   *                    |  |
   *                    |  |
   *                    | waitForCheckpointState (1s before slot 0 of epoch, wait until slot 1 of epoch)
   *                    |
   *              prepareNextSlot (4s before next slot)
   */
  async function waitForCheckpointState(cpHex: CheckpointHex): Promise<CachedBeaconStateAllForks | null> {
    const cpState = chain.regen.getCheckpointStateSync(cpHex);
    if (cpState) {
      return cpState;
    }
    const cp = {
      epoch: cpHex.epoch,
      root: fromHexString(cpHex.rootHex),
    };
    const slot0 = computeStartSlotAtEpoch(cp.epoch);
    // if not, wait for ChainEvent.checkpoint event until slot 1 of epoch
    let listener: ((eventCp: phase0.Checkpoint) => void) | null = null;
    const foundCPState = await Promise.race([
      new Promise((resolve) => {
        listener = (eventCp) => {
          resolve(ssz.phase0.Checkpoint.equals(eventCp, cp));
        };
        chain.emitter.once(ChainEvent.checkpoint, listener);
      }),
      // in rare case, checkpoint state cache may happen up to 6s of slot 0 of epoch
      // so we wait for it until the slot 1 of epoch
      chain.clock.waitForSlot(slot0 + 1),
    ]);

    if (listener != null) {
      chain.emitter.off(ChainEvent.checkpoint, listener);
    }

    if (foundCPState === true) {
      return chain.regen.getCheckpointStateSync(cpHex);
    }

    return null;
  }

  /**
   * Reject any request while the node is syncing
   */
  function notWhileSyncing(): void {
    // Consider node synced before or close to genesis
    if (chain.clock.currentSlot < SLOTS_PER_EPOCH) {
      return;
    }

    const syncState = sync.state;
    switch (syncState) {
      case SyncState.SyncingFinalized:
      case SyncState.SyncingHead: {
        const currentSlot = chain.clock.currentSlot;
        const headSlot = chain.forkChoice.getHead().slot;
        if (currentSlot - headSlot > SYNC_TOLERANCE_EPOCHS * SLOTS_PER_EPOCH) {
          throw new NodeIsSyncing(`headSlot ${headSlot} currentSlot ${currentSlot}`);
        } else {
          return;
        }
      }

      case SyncState.Synced:
        return;

      case SyncState.Stalled:
        throw new NodeIsSyncing("waiting for peers");
    }
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
   * 3. ProduceBlock if the parentRoot (chain's current head is optimistic). However this doesn't
   *    need to be checked/aborted here as assembleBody would call EL's api for the latest
   *    executionStatus of the parentRoot. If still not validated, produceBlock will throw error.
   *
   * TODO/PENDING: SyncCommitteeSignatures should also be aborted, the best way to address this
   *   is still in flux and will be updated as and when other CL's figure this out.
   */

  function notOnOptimisticBlockRoot(beaconBlockRoot: Root): void {
    const protoBeaconBlock = chain.forkChoice.getBlock(beaconBlockRoot);
    if (!protoBeaconBlock) {
      throw new ApiError(400, "Block not in forkChoice");
    }

    if (protoBeaconBlock.executionStatus === ExecutionStatus.Syncing)
      throw new NodeIsSyncing(
        `Block's execution payload not yet validated, executionPayloadBlockHash=${protoBeaconBlock.executionPayloadBlockHash} number=${protoBeaconBlock.executionPayloadNumber}`
      );
  }

  const deps: ValidatorEndpointDependencies = {
    notOnOptimisticBlockRoot,
    notWhileSyncing,
    waitForSlotWithDisparity: waitForSlot,
    getGenesisBlockRoot,
    waitForNextClosestEpoch,
    currentEpochWithDisparity,
    msToNextEpoch,
    waitForCheckpointState,
  };

  const produceBlockV2 = buildProduceBlockV2(modules, deps);
  const produceBlock = buildProduceBlock(modules, {...deps, produceBlockV2});
  const produceBlockV3 = buildProduceBlockV3(modules, {...deps, produceBlockV2});
  const produceBlindedBlock = buildProduceBlindedBlock(modules, {...deps, produceBlockV3});
  const produceAttestationData = buildProduceAttestationData(modules, deps);
  const produceSyncCommitteeContribution = buildProduceSyncCommitteeContribution(modules, deps);
  const getProposerDuties = buildGetProposerDuties(modules, deps);
  const getAttesterDuties = buildGetAttesterDuties(modules, deps);
  const getSyncCommitteeDuties = buildGetSyncCommitteeDuties(modules, deps);
  const getAggregatedAttestation = buildGetAggregatedAttestation(modules, deps);
  const publishAggregateAndProofs = buildPublishAggregateAndProofs(modules, deps);
  const publishContributionAndProofs = buildPublishContributionAndProofs(modules, deps);
  const prepareBeaconCommitteeSubnet = buildPrepareBeaconCommitteeSubnet(modules, deps);
  const prepareSyncCommitteeSubnets = buildPrepareSyncCommitteeSubnets(modules, deps);
  const prepareBeaconProposer = buildPrepareBeaconProposer(modules, deps);
  const submitBeaconCommitteeSelections = buildSubmitBeaconCommitteeSelections(modules, deps);
  const submitSyncCommitteeSelections = buildSubmitSyncCommitteeSelections(modules, deps);
  const getLiveness = buildGetLiveness(modules, deps);
  const registerValidator = buildRegisterValidator(modules, deps);

  return {
    produceBlock,
    produceBlockV2,
    produceBlockV3,
    produceBlindedBlock,
    produceAttestationData,
    produceSyncCommitteeContribution,
    getProposerDuties,
    getAttesterDuties,
    getSyncCommitteeDuties,
    getAggregatedAttestation,
    publishAggregateAndProofs,
    publishContributionAndProofs,
    prepareBeaconCommitteeSubnet,
    prepareSyncCommitteeSubnets,
    prepareBeaconProposer,
    submitBeaconCommitteeSelections,
    submitSyncCommitteeSelections,
    getLiveness,
    registerValidator,
  };
}
