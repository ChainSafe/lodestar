import {routes} from "@chainsafe/lodestar-api";
import bls, {Signature} from "@chainsafe/bls";
import {
  CachedBeaconState,
  computeStartSlotAtEpoch,
  proposerShufflingDecisionRoot,
  attesterShufflingDecisionRoot,
  computeSubnetForCommitteesAtSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {GENESIS_SLOT, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {Root, Slot} from "@chainsafe/lodestar-types";
import {BeaconState} from "@chainsafe/lodestar-types/lib/allForks";
import {readonlyValues} from "@chainsafe/ssz";
import {assembleAttestationData} from "../../../chain/factory/attestation";
import {assembleBlock} from "../../../chain/factory/block";
import {assembleAttesterDuty} from "../../../chain/factory/duties";
import {validateGossipAggregateAndProof} from "../../../chain/validation";
import {ZERO_HASH} from "../../../constants";
import {SyncState} from "../../../sync";
import {toGraffitiBuffer} from "../../../util/graffiti";
import {ApiError} from "../errors";
import {validateSyncCommitteeGossipContributionAndProof} from "../../../chain/validation/syncCommitteeContributionAndProof";
import {CommitteeSubscription} from "../../../network/subnets";
import {getSyncComitteeValidatorIndexMap} from "./utils";
import {ApiModules} from "../types";

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
  async function getGenesisBlockRoot(state: CachedBeaconState<BeaconState>): Promise<Root> {
    if (!genesisBlockRoot) {
      // Close to genesis the genesis block may not be available in the DB
      if (state.slot < config.params.SLOTS_PER_HISTORICAL_ROOT) {
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
    const slotStartSec = chain.genesisTime + slot * config.params.SECONDS_PER_SLOT;
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
    const secPerEpoch = config.params.SLOTS_PER_EPOCH * config.params.SECONDS_PER_SLOT;
    const nextEpochStartSec = chain.genesisTime + nextEpoch * secPerEpoch;
    const msToNextEpoch = nextEpochStartSec * 1000 - Date.now();
    if (msToNextEpoch > 0 && msToNextEpoch < MAX_API_CLOCK_DISPARITY_MS) {
      await chain.clock.waitForSlot(computeStartSlotAtEpoch(config, nextEpoch));
    }
  }

  /**
   * Reject any request while the node is syncing
   */
  function notWhileSyncing(): void {
    // Consider node synced before or close to genesis
    if (chain.clock.currentSlot < config.params.SLOTS_PER_EPOCH) {
      return;
    }

    const syncState = sync.state;
    switch (syncState) {
      case SyncState.SyncingFinalized:
      case SyncState.SyncingHead: {
        const currentSlot = chain.clock.currentSlot;
        const headSlot = chain.forkChoice.getHead().slot;
        if (currentSlot - headSlot > SYNC_TOLERANCE_EPOCHS * config.params.SLOTS_PER_EPOCH) {
          throw new ApiError(503, `Node is syncing, headSlot ${headSlot} currentSlot ${currentSlot}`);
        } else {
          return;
        }
      }

      case SyncState.Synced:
        return;

      case SyncState.Stalled:
        throw new ApiError(503, "Node is waiting for peers");
    }
  }

  return {
    async produceBlock(slot, randaoReveal, graffiti = "") {
      notWhileSyncing();

      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      const block = await assembleBlock(
        {config: config, chain: chain, db: db, eth1: eth1, metrics: metrics},
        slot,
        randaoReveal,
        toGraffitiBuffer(graffiti)
      );

      return {data: block, version: config.getForkName(block.slot)};
    },

    async produceAttestationData(committeeIndex, slot) {
      notWhileSyncing();

      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      const headRoot = chain.forkChoice.getHeadRoot();
      const state = await chain.regen.getBlockSlotState(headRoot, slot);
      return {data: assembleAttestationData(state.config, state, headRoot, slot, committeeIndex)};
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
      const contribution = db.syncCommittee.getSyncCommitteeContribution(subcommitteeIndex, slot, beaconBlockRoot);
      if (!contribution) throw new ApiError(500, "No contribution available");
      return {data: contribution};
    },

    async getProposerDuties(epoch) {
      notWhileSyncing();

      const startSlot = computeStartSlotAtEpoch(config, epoch);
      await waitForSlot(startSlot); // Must never request for a future slot > currentSlot

      const state = await chain.getHeadStateAtCurrentEpoch();
      const duties: routes.validator.ProposerDuty[] = [];

      for (let slot = startSlot; slot < startSlot + config.params.SLOTS_PER_EPOCH; slot++) {
        // getBeaconProposer ensures the requested epoch is correct
        const blockProposerIndex = state.getBeaconProposer(slot);
        duties.push({slot, validatorIndex: blockProposerIndex, pubkey: state.validators[blockProposerIndex].pubkey});
      }

      // Returns `null` on the one-off scenario where the genesis block decides its own shuffling.
      // It should be set to the latest block applied to `self` or the genesis block root.
      const dependentRoot = proposerShufflingDecisionRoot(config, state) || (await getGenesisBlockRoot(state));

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

      const duties: routes.validator.AttesterDuty[] = [];
      for (const validatorIndex of validatorIndices) {
        const validator = state.validators[validatorIndex];
        if (!validator) {
          throw new ApiError(400, `Validator index ${validatorIndex} not in state`);
        }
        const duty = assembleAttesterDuty(
          config,
          {pubkey: validator.pubkey, index: validatorIndex},
          state.epochCtx,
          epoch
        );
        if (duty) duties.push(duty);
      }

      const dependentRoot = attesterShufflingDecisionRoot(config, state, epoch) || (await getGenesisBlockRoot(state));

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
      const syncComitteeValidatorIndexMap = getSyncComitteeValidatorIndexMap(config, state, epoch);

      const duties: routes.validator.SyncDuty[] = validatorIndices.map((validatorIndex) => ({
        pubkey: state.index2pubkey[validatorIndex].toBytes(),
        validatorIndex,
        validatorSyncCommitteeIndices: syncComitteeValidatorIndexMap.get(validatorIndex) ?? [],
      }));

      return {
        data: duties,
        // TODO: Compute a proper dependentRoot for this syncCommittee shuffling
        dependentRoot: ZERO_HASH,
      };
    },

    async getAggregatedAttestation(attestationDataRoot, slot) {
      notWhileSyncing();

      await waitForSlot(slot); // Must never request for a future slot > currentSlot

      const attestations = await db.attestation.getAttestationsByDataRoot(slot, attestationDataRoot);

      if (attestations.length === 0) {
        throw Error("No matching attestations found for attestationData");
      }

      // first iterate through collected committee attestations
      // expanding each signature and building an aggregated bitlist
      const signatures: Signature[] = [];
      const aggregationBits = attestations[0].aggregationBits;
      for (const attestation of attestations) {
        try {
          const signature = bls.Signature.fromBytes(attestation.signature.valueOf() as Uint8Array);
          signatures.push(signature);
          let index = 0;
          for (const bit of readonlyValues(attestation.aggregationBits)) {
            if (bit) {
              aggregationBits[index] = true;
            }
            index++;
          }
        } catch (e) {
          logger.verbose("Invalid attestation signature", e);
        }
      }

      // then create/return the aggregate signature
      return {
        data: {
          data: attestations[0].data,
          signature: bls.Signature.aggregate(signatures).toBytes(),
          aggregationBits,
        },
      };
    },

    async publishAggregateAndProofs(signedAggregateAndProofs) {
      notWhileSyncing();

      const errors: Error[] = [];

      await Promise.all(
        signedAggregateAndProofs.map(async (signedAggregateAndProof, i) => {
          try {
            const attestation = signedAggregateAndProof.message.aggregate;
            // TODO: Validate in batch
            await validateGossipAggregateAndProof(config, chain, db, signedAggregateAndProof, {
              attestation: attestation,
              validSignature: false,
            });
            await Promise.all([
              db.aggregateAndProof.add(signedAggregateAndProof.message),
              db.seenAttestationCache.addAggregateAndProof(signedAggregateAndProof.message),
              network.gossip.publishBeaconAggregateAndProof(signedAggregateAndProof),
            ]);
          } catch (e) {
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
            await validateSyncCommitteeGossipContributionAndProof(config, chain, db, {
              contributionAndProof,
              validSignature: false,
            });
            db.syncCommitteeContribution.add(contributionAndProof.message);
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
          subnet: computeSubnetForCommitteesAtSlot(config, slot, committeesAtSlot, committeeIndex),
          slot: slot,
          isAggregator: isAggregator,
        }))
      );

      // TODO:
      // If the discovery mechanism isn't disabled, attempt to set up a peer discovery for the
      // required subnets.
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
      const SYNC_COMMITTEE_SUBNET_SIZE = Math.floor(config.params.SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);

      // A `validatorIndex` can be in multiple subnets, so compute the CommitteeSubscription with double for loop
      const subs: CommitteeSubscription[] = [];
      for (const sub of subscriptions) {
        for (const committeeIndex of sub.syncCommitteeIndices) {
          const subnet = Math.floor(committeeIndex / SYNC_COMMITTEE_SUBNET_SIZE);
          subs.push({
            validatorIndex: sub.validatorIndex,
            subnet: subnet,
            // Subscribe until the end of `untilEpoch`: https://github.com/ethereum/eth2.0-APIs/pull/136#issuecomment-840315097
            slot: computeStartSlotAtEpoch(config, sub.untilEpoch + 1),
            isAggregator: true,
          });
        }
      }

      network.prepareSyncCommitteeSubnets(subs);
    },
  };
}
