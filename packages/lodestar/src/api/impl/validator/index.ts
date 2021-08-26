import {routes} from "@chainsafe/lodestar-api";
import {
  CachedBeaconState,
  computeStartSlotAtEpoch,
  proposerShufflingDecisionRoot,
  attesterShufflingDecisionRoot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {
  GENESIS_SLOT,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
  SYNC_COMMITTEE_SIZE,
  SYNC_COMMITTEE_SUBNET_COUNT,
} from "@chainsafe/lodestar-params";
import {allForks, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {assembleAttestationData} from "../../../chain/factory/attestation";
import {assembleBlock} from "../../../chain/factory/block";
import {AttestationError, AttestationErrorCode} from "../../../chain/errors";
import {validateGossipAggregateAndProof} from "../../../chain/validation";
import {ZERO_HASH} from "../../../constants";
import {SyncState} from "../../../sync";
import {toGraffitiBuffer} from "../../../util/graffiti";
import {ApiError, NodeIsSyncing} from "../errors";
import {validateSyncCommitteeGossipContributionAndProof} from "../../../chain/validation/syncCommitteeContributionAndProof";
import {CommitteeSubscription} from "../../../network/subnets";
import {OpSource} from "../../../metrics/validatorMonitor";
import {computeSubnetForCommitteesAtSlot, getPubkeysForIndices, getSyncComitteeValidatorIndexMap} from "./utils";
import {ApiModules} from "../types";
import {RegenCaller} from "../../../chain/regen";

/**
 * Validator clock may be advanced from beacon's clock. If the validator requests a resource in a
 * future slot, wait some time instead of rejecting the request because it's in the future
 */
const MAX_API_CLOCK_DISPARITY_MS = 1000;

/**
 * If the node is within this many epochs from the head, we declare it to be synced regardless of
 * the network sync state.
 *
 * This helps prevent attacks where nodes can convince us that we're syncing some non-existent
 * finalized head.
 */
const SYNC_TOLERANCE_EPOCHS = 8;

/**
 * Server implementation for handling validator duties.
 * See `@chainsafe/lodestar-validator/src/api` for the client implementation).
 */
export function getValidatorApi({
  chain,
  config,
  db,
  eth1,
  logger,
  metrics,
  network,
  sync,
}: ApiModules): routes.validator.Api {
  let genesisBlockRoot: Root | null = null;

  /** Compute and cache the genesis block root */
  async function getGenesisBlockRoot(state: CachedBeaconState<allForks.BeaconState>): Promise<Root> {
    if (!genesisBlockRoot) {
      // Close to genesis the genesis block may not be available in the DB
      if (state.slot < SLOTS_PER_HISTORICAL_ROOT) {
        genesisBlockRoot = state.blockRoots[0];
      }

      const genesisBlock = await chain.getCanonicalBlockAtSlot(GENESIS_SLOT);
      if (genesisBlock) {
        genesisBlockRoot = config.getForkTypes(genesisBlock.message.slot).SignedBeaconBlock.hashTreeRoot(genesisBlock);
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
    const slotStartSec = chain.genesisTime + slot * config.SECONDS_PER_SLOT;
    const msToSlot = slotStartSec * 1000 - Date.now();
    if (msToSlot > 0 && msToSlot < MAX_API_CLOCK_DISPARITY_MS) {
      await chain.clock.waitForSlot(slot);
    }
  }

  /**
   * If advancing the local clock `MAX_API_CLOCK_DISPARITY_MS` ticks to the next epoch, wait for slot 0 of the next epoch.
   * Prevents a validator from not being able to get the attestater duties correctly if the beacon and validator clocks are off
   */
  async function waitForNextClosestEpoch(): Promise<void> {
    const nextEpoch = chain.clock.currentEpoch + 1;
    const secPerEpoch = SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT;
    const nextEpochStartSec = chain.genesisTime + nextEpoch * secPerEpoch;
    const msToNextEpoch = nextEpochStartSec * 1000 - Date.now();
    if (msToNextEpoch > 0 && msToNextEpoch < MAX_API_CLOCK_DISPARITY_MS) {
      await chain.clock.waitForSlot(computeStartSlotAtEpoch(nextEpoch));
    }
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

  return {
    async produceBlock(slot, randaoReveal, graffiti = "") {
      let timer;
      metrics?.blockProductionRequests.inc();
      try {
        notWhileSyncing();
        await waitForSlot(slot); // Must never request for a future slot > currentSlot

        timer = metrics?.blockProductionTime.startTimer();
        const block = await assembleBlock(
          {config, chain, db, eth1, metrics},
          slot,
          randaoReveal,
          toGraffitiBuffer(graffiti)
        );
        metrics?.blockProductionSuccess.inc();
        return {data: block, version: config.getForkName(block.slot)};
      } finally {
        if (timer) timer();
      }
    },

    async produceAttestationData(committeeIndex, slot) {
      notWhileSyncing();

      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      const headRoot = chain.forkChoice.getHeadRoot();
      const state = await chain.regen.getBlockSlotState(headRoot, slot, RegenCaller.produceAttestationData);
      return {data: assembleAttestationData(state, headRoot, slot, committeeIndex)};
    },

    /**
     * GET `/eth/v1/validator/sync_committee_contribution`
     *
     * Requests that the beacon node produce a sync committee contribution.
     *
     * https://github.com/ethereum/eth2.0-APIs/pull/138
     *
     * @param slot The slot for which a sync committee contribution should be created.
     * @param subcommitteeIndex The subcommittee index for which to produce the contribution.
     * @param beaconBlockRoot The block root for which to produce the contribution.
     */
    async produceSyncCommitteeContribution(slot, subcommitteeIndex, beaconBlockRoot) {
      const contribution = chain.syncCommitteeMessagePool.getContribution(subcommitteeIndex, slot, beaconBlockRoot);
      if (!contribution) throw new ApiError(500, "No contribution available");
      return {data: contribution};
    },

    async getProposerDuties(epoch) {
      notWhileSyncing();

      const startSlot = computeStartSlotAtEpoch(epoch);
      await waitForSlot(startSlot); // Must never request for a future slot > currentSlot

      const state = await chain.getHeadStateAtCurrentEpoch();

      // Note: Using a MutableVector is the fastest way of getting compressed pubkeys.
      //       See benchmark -> packages/lodestar/test/perf/api/impl/validator/attester.test.ts
      const validators = state.validators; // Get the validators sub tree once for all the loop
      const duties: routes.validator.ProposerDuty[] = [];

      for (let slot = startSlot; slot < startSlot + SLOTS_PER_EPOCH; slot++) {
        // getBeaconProposer ensures the requested epoch is correct
        const validatorIndex = state.getBeaconProposer(slot);
        const validator = validators[validatorIndex];
        duties.push({slot, validatorIndex, pubkey: validator.pubkey});
      }

      // Returns `null` on the one-off scenario where the genesis block decides its own shuffling.
      // It should be set to the latest block applied to `self` or the genesis block root.
      const dependentRoot = proposerShufflingDecisionRoot(state) || (await getGenesisBlockRoot(state));

      return {
        data: duties,
        dependentRoot,
      };
    },

    async getAttesterDuties(epoch, validatorIndices) {
      notWhileSyncing();

      if (validatorIndices.length === 0) {
        throw new ApiError(400, "No validator to get attester duties");
      }

      // May request for an epoch that's in the future
      await waitForNextClosestEpoch();

      // Check if the epoch is in the future after waiting for requested slot
      if (epoch > chain.clock.currentEpoch + 1) {
        throw new ApiError(400, "Cannot get duties for epoch more than one ahead");
      }

      const state = await chain.getHeadStateAtCurrentEpoch();

      // TODO: Determine what the current epoch would be if we fast-forward our system clock by
      // `MAXIMUM_GOSSIP_CLOCK_DISPARITY`.
      //
      // Most of the time, `tolerantCurrentEpoch` will be equal to `currentEpoch`. However, during
      // the first `MAXIMUM_GOSSIP_CLOCK_DISPARITY` duration of the epoch `tolerantCurrentEpoch`
      // will equal `currentEpoch + 1`

      // Check that all validatorIndex belong to the state before calling getCommitteeAssignments()
      const getPubkey = getPubkeysForIndices(state, validatorIndices);

      const committeeAssignments = state.epochCtx.getCommitteeAssignments(epoch, validatorIndices);
      const duties = committeeAssignments as routes.validator.AttesterDuty[];
      for (const duty of duties) {
        // Mutate existing object instead of re-creating another new object with spread operator
        // Should be faster and require less memory
        duty.pubkey = getPubkey(duty.validatorIndex);
      }

      const dependentRoot = attesterShufflingDecisionRoot(state, epoch) || (await getGenesisBlockRoot(state));

      return {
        data: duties,
        dependentRoot,
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
     * https://github.com/ethereum/eth2.0-APIs/pull/134
     *
     * @param validatorIndices an array of the validator indices for which to obtain the duties.
     */
    async getSyncCommitteeDuties(epoch, validatorIndices) {
      notWhileSyncing();

      if (validatorIndices.length === 0) {
        throw new ApiError(400, "No validator to get attester duties");
      }

      // May request for an epoch that's in the future
      await waitForNextClosestEpoch();

      // Note: does not support requesting past duties
      const state = chain.getHeadState();

      // Ensures `epoch // EPOCHS_PER_SYNC_COMMITTEE_PERIOD <= current_epoch // EPOCHS_PER_SYNC_COMMITTEE_PERIOD + 1`
      const syncComitteeValidatorIndexMap = getSyncComitteeValidatorIndexMap(state, epoch);
      const getPubkey = getPubkeysForIndices(state, validatorIndices);

      const duties: routes.validator.SyncDuty[] = [];
      for (const validatorIndex of validatorIndices) {
        const validatorSyncCommitteeIndices = syncComitteeValidatorIndexMap.get(validatorIndex);
        if (validatorSyncCommitteeIndices) {
          duties.push({
            pubkey: getPubkey(validatorIndex),
            validatorIndex,
            validatorSyncCommitteeIndices,
          });
        }
      }

      return {
        data: duties,
        // TODO: Compute a proper dependentRoot for this syncCommittee shuffling
        dependentRoot: ZERO_HASH,
      };
    },

    async getAggregatedAttestation(attestationDataRoot, slot) {
      notWhileSyncing();

      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      return {
        data: chain.attestationPool.getAggregate(slot, attestationDataRoot),
      };
    },

    async publishAggregateAndProofs(signedAggregateAndProofs) {
      notWhileSyncing();

      const seenTimestampSec = Date.now() / 1000;
      const errors: Error[] = [];

      await Promise.all(
        signedAggregateAndProofs.map(async (signedAggregateAndProof, i) => {
          try {
            // TODO: Validate in batch
            const {indexedAttestation, committeeIndices} = await validateGossipAggregateAndProof(
              chain,
              signedAggregateAndProof
            );

            metrics?.registerAggregatedAttestation(
              OpSource.api,
              seenTimestampSec,
              signedAggregateAndProof,
              indexedAttestation
            );

            await Promise.all([
              chain.aggregatedAttestationPool.add(
                signedAggregateAndProof.message.aggregate,
                indexedAttestation.attestingIndices.valueOf() as ValidatorIndex[],
                committeeIndices
              ),
              network.gossip.publishBeaconAggregateAndProof(signedAggregateAndProof),
            ]);
          } catch (e) {
            if (e instanceof AttestationError && e.type.code === AttestationErrorCode.AGGREGATOR_ALREADY_KNOWN) {
              logger.debug("Ignoring known signedAggregateAndProof");
              return; // Ok to submit the same aggregate twice
            }

            errors.push(e);
            logger.error(
              `Error on publishAggregateAndProofs [${i}]`,
              {
                slot: signedAggregateAndProof.message.aggregate.data.slot,
                index: signedAggregateAndProof.message.aggregate.data.index,
              },
              e
            );
          }
        })
      );

      if (errors.length > 1) {
        throw Error("Multiple errors on publishAggregateAndProofs\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
        throw errors[0];
      }
    },

    /**
     * POST `/eth/v1/validator/contribution_and_proofs`
     *
     * Publish multiple signed sync committee contribution and proofs
     *
     * https://github.com/ethereum/eth2.0-APIs/pull/137
     */
    async publishContributionAndProofs(contributionAndProofs) {
      notWhileSyncing();

      const errors: Error[] = [];

      await Promise.all(
        contributionAndProofs.map(async (contributionAndProof, i) => {
          try {
            // TODO: Validate in batch
            await validateSyncCommitteeGossipContributionAndProof(chain, contributionAndProof);
            chain.syncContributionAndProofPool.add(contributionAndProof.message);
            await network.gossip.publishContributionAndProof(contributionAndProof);
          } catch (e) {
            errors.push(e);
            logger.error(
              `Error on publishContributionAndProofs [${i}]`,
              {
                slot: contributionAndProof.message.contribution.slot,
                subCommitteeIndex: contributionAndProof.message.contribution.subCommitteeIndex,
              },
              e
            );
          }
        })
      );

      if (errors.length > 1) {
        throw Error("Multiple errors on publishContributionAndProofs\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
        throw errors[0];
      }
    },

    async prepareBeaconCommitteeSubnet(subscriptions) {
      notWhileSyncing();

      network.prepareBeaconCommitteeSubnet(
        subscriptions.map(({validatorIndex, slot, isAggregator, committeesAtSlot, committeeIndex}) => ({
          validatorIndex: validatorIndex,
          subnet: computeSubnetForCommitteesAtSlot(slot, committeesAtSlot, committeeIndex),
          slot: slot,
          isAggregator: isAggregator,
        }))
      );

      // TODO:
      // If the discovery mechanism isn't disabled, attempt to set up a peer discovery for the
      // required subnets.

      if (metrics) {
        for (const subscription of subscriptions) {
          metrics.registerLocalValidator(subscription.validatorIndex);
        }
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
     * https://github.com/ethereum/eth2.0-APIs/pull/136
     */
    async prepareSyncCommitteeSubnets(subscriptions) {
      notWhileSyncing();

      // TODO: Cache this value
      const SYNC_COMMITTEE_SUBNET_SIZE = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);

      // A `validatorIndex` can be in multiple subnets, so compute the CommitteeSubscription with double for loop
      const subs: CommitteeSubscription[] = [];
      for (const sub of subscriptions) {
        for (const committeeIndex of sub.syncCommitteeIndices) {
          const subnet = Math.floor(committeeIndex / SYNC_COMMITTEE_SUBNET_SIZE);
          subs.push({
            validatorIndex: sub.validatorIndex,
            subnet: subnet,
            // Subscribe until the end of `untilEpoch`: https://github.com/ethereum/eth2.0-APIs/pull/136#issuecomment-840315097
            slot: computeStartSlotAtEpoch(sub.untilEpoch + 1),
            isAggregator: true,
          });
        }
      }

      network.prepareSyncCommitteeSubnets(subs);
    },
  };
}
