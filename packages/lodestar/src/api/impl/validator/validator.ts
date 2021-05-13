/**
 * @module api/rpc
 */

import bls, {Signature} from "@chainsafe/bls";
import {
  CachedBeaconState,
  computeStartSlotAtEpoch,
  proposerShufflingDecisionRoot,
  attesterShufflingDecisionRoot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {Bytes96, CommitteeIndex, Epoch, Root, phase0, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {BeaconState} from "@chainsafe/lodestar-types/lib/allForks";
import {ILogger} from "@chainsafe/lodestar-utils";
import {readonlyValues} from "@chainsafe/ssz";
import {IAttestationJob, IBeaconChain} from "../../../chain";
import {assembleAttestationData} from "../../../chain/factory/attestation";
import {assembleBlock} from "../../../chain/factory/block";
import {assembleAttesterDuty} from "../../../chain/factory/duties";
import {validateGossipAggregateAndProof} from "../../../chain/validation";
import {ZERO_HASH} from "../../../constants";
import {IBeaconDb} from "../../../db";
import {IEth1ForBlockProduction} from "../../../eth1";
import {IMetrics} from "../../../metrics";
import {INetwork} from "../../../network";
import {IBeaconSync, SyncState} from "../../../sync";
import {toGraffitiBuffer} from "../../../util/graffiti";
import {IApiOptions} from "../../options";
import {ApiError} from "../errors";
import {ApiNamespace, IApiModules} from "../interface";
import {IValidatorApi} from "./interface";

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
export class ValidatorApi implements IValidatorApi {
  namespace: ApiNamespace;

  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private db: IBeaconDb;
  private eth1: IEth1ForBlockProduction;
  private network: INetwork;
  private sync: IBeaconSync;
  private metrics: IMetrics | null;
  private logger: ILogger;
  // Cached for duties
  private genesisBlockRoot: Root | null = null;

  constructor(
    opts: Partial<IApiOptions>,
    modules: Pick<IApiModules, "config" | "chain" | "db" | "eth1" | "network" | "sync" | "metrics" | "logger">
  ) {
    this.namespace = ApiNamespace.VALIDATOR;
    this.config = modules.config;
    this.chain = modules.chain;
    this.db = modules.db;
    this.eth1 = modules.eth1;
    this.network = modules.network;
    this.sync = modules.sync;
    this.metrics = modules.metrics;
    this.logger = modules.logger;
  }

  async produceBlock(slot: Slot, randaoReveal: Bytes96, graffiti = ""): Promise<phase0.BeaconBlock> {
    this.notWhileSyncing();

    await this.waitForSlot(slot); // Must never request for a future slot > currentSlot

    return await assembleBlock(
      {config: this.config, chain: this.chain, db: this.db, eth1: this.eth1, metrics: this.metrics},
      slot,
      randaoReveal,
      toGraffitiBuffer(graffiti)
    );
  }

  async produceAttestationData(committeeIndex: CommitteeIndex, slot: Slot): Promise<phase0.AttestationData> {
    this.notWhileSyncing();

    await this.waitForSlot(slot); // Must never request for a future slot > currentSlot

    const headRoot = this.chain.forkChoice.getHeadRoot();
    const state = await this.chain.regen.getBlockSlotState(headRoot, slot);
    return assembleAttestationData(
      state.config,
      state as CachedBeaconState<phase0.BeaconState>,
      headRoot,
      slot,
      committeeIndex
    );
  }

  async getProposerDuties(epoch: Epoch): Promise<phase0.ProposerDutiesApi> {
    this.notWhileSyncing();

    const startSlot = computeStartSlotAtEpoch(this.config, epoch);
    await this.waitForSlot(startSlot); // Must never request for a future slot > currentSlot

    const state = await this.chain.getHeadStateAtCurrentEpoch();
    const duties: phase0.ProposerDuty[] = [];

    for (let slot = startSlot; slot < startSlot + this.config.params.SLOTS_PER_EPOCH; slot++) {
      // getBeaconProposer ensures the requested epoch is correct
      const blockProposerIndex = state.getBeaconProposer(slot);
      duties.push({slot, validatorIndex: blockProposerIndex, pubkey: state.validators[blockProposerIndex].pubkey});
    }

    // Returns `null` on the one-off scenario where the genesis block decides its own shuffling.
    // It should be set to the latest block applied to `self` or the genesis block root.
    const dependentRoot = proposerShufflingDecisionRoot(this.config, state) || (await this.getGenesisBlockRoot(state));

    return {
      data: duties,
      dependentRoot,
    };
  }

  async getAttesterDuties(epoch: number, validatorIndices: ValidatorIndex[]): Promise<phase0.AttesterDutiesApi> {
    this.notWhileSyncing();

    if (validatorIndices.length === 0) {
      throw new ApiError(400, "No validator to get attester duties");
    }

    // May request for an epoch that's in the future
    await this.waitForNextClosestEpoch();

    // Check if the epoch is in the future after waiting for requested slot
    if (epoch > this.chain.clock.currentEpoch + 1) {
      throw new ApiError(400, "Cannot get duties for epoch more than one ahead");
    }

    const state = await this.chain.getHeadStateAtCurrentEpoch();

    // TODO: Determine what the current epoch would be if we fast-forward our system clock by
    // `MAXIMUM_GOSSIP_CLOCK_DISPARITY`.
    //
    // Most of the time, `tolerantCurrentEpoch` will be equal to `currentEpoch`. However, during
    // the first `MAXIMUM_GOSSIP_CLOCK_DISPARITY` duration of the epoch `tolerantCurrentEpoch`
    // will equal `currentEpoch + 1`

    const duties: phase0.AttesterDuty[] = [];
    for (const validatorIndex of validatorIndices) {
      const validator = state.validators[validatorIndex];
      if (!validator) {
        throw new ApiError(400, `Validator index ${validatorIndex} not in state`);
      }
      const duty = assembleAttesterDuty(
        this.config,
        {pubkey: validator.pubkey, index: validatorIndex},
        state.epochCtx,
        epoch
      );
      if (duty) duties.push(duty);
    }

    const dependentRoot =
      attesterShufflingDecisionRoot(this.config, state, epoch) || (await this.getGenesisBlockRoot(state));

    return {
      data: duties,
      dependentRoot,
    };
  }

  async getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<phase0.Attestation> {
    this.notWhileSyncing();

    await this.waitForSlot(slot); // Must never request for a future slot > currentSlot

    const attestations = await this.db.attestation.getAttestationsByDataRoot(slot, attestationDataRoot);

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
        this.logger.verbose("Invalid attestation signature", e);
      }
    }

    // then create/return the aggregate signature
    return {
      data: attestations[0].data,
      signature: bls.Signature.aggregate(signatures).toBytes(),
      aggregationBits,
    };
  }

  async publishAggregateAndProofs(signedAggregateAndProofs: phase0.SignedAggregateAndProof[]): Promise<void> {
    this.notWhileSyncing();

    await Promise.all(
      signedAggregateAndProofs.map(async (signedAggregateAndProof) => {
        try {
          const attestation = signedAggregateAndProof.message.aggregate;
          const attestationJob = {
            attestation: attestation,
            validSignature: false,
          } as IAttestationJob;
          await validateGossipAggregateAndProof(
            this.config,
            this.chain,
            this.db,
            signedAggregateAndProof,
            attestationJob
          );
          await Promise.all([
            this.db.aggregateAndProof.add(signedAggregateAndProof.message),
            this.db.seenAttestationCache.addAggregateAndProof(signedAggregateAndProof.message),
            this.network.gossip.publishBeaconAggregateAndProof(signedAggregateAndProof),
          ]);
        } catch (e) {
          this.logger.warn("Failed to publish aggregate and proof", e);
        }
      })
    );
  }

  async prepareBeaconCommitteeSubnet(subscriptions: phase0.BeaconCommitteeSubscription[]): Promise<void> {
    this.notWhileSyncing();

    this.network.prepareBeaconCommitteeSubnet(subscriptions);

    // TODO:
    // If the discovery mechanism isn't disabled, attempt to set up a peer discovery for the
    // required subnets.
  }

  /** Compute and cache the genesis block root */
  private async getGenesisBlockRoot(state: CachedBeaconState<BeaconState>): Promise<Root> {
    if (!this.genesisBlockRoot) {
      // Close to genesis the genesis block may not be available in the DB
      if (state.slot < this.config.params.SLOTS_PER_HISTORICAL_ROOT) {
        this.genesisBlockRoot = state.blockRoots[0];
      }

      const genesisBlock = await this.chain.getCanonicalBlockAtSlot(GENESIS_SLOT);
      if (genesisBlock) {
        this.genesisBlockRoot = this.config.types.phase0.SignedBeaconBlock.hashTreeRoot(genesisBlock);
      }
    }

    // If for some reason the genesisBlockRoot is not able don't prevent validators from
    // proposing or attesting. If the genesisBlockRoot is wrong, at worst it may trigger a re-fetch of the duties
    return this.genesisBlockRoot || ZERO_HASH;
  }

  /**
   * If advancing the local clock `MAX_API_CLOCK_DISPARITY_MS` ticks to the requested slot, wait for its start
   * Prevents the validator from getting errors from the API if the clock is a bit advanced
   */
  private async waitForSlot(slot: Slot): Promise<void> {
    const slotStartSec = this.chain.genesisTime + slot * this.config.params.SECONDS_PER_SLOT;
    const msToSlot = slotStartSec * 1000 - Date.now();
    if (msToSlot > 0 && msToSlot < MAX_API_CLOCK_DISPARITY_MS) {
      await this.chain.clock.waitForSlot(slot);
    }
  }

  /**
   * If advancing the local clock `MAX_API_CLOCK_DISPARITY_MS` ticks to the next epoch, wait for slot 0 of the next epoch.
   * Prevents a validator from not being able to get the attestater duties correctly if the beacon and validator clocks are off
   */
  private async waitForNextClosestEpoch(): Promise<void> {
    const nextEpoch = this.chain.clock.currentEpoch + 1;
    const secPerEpoch = this.config.params.SLOTS_PER_EPOCH * this.config.params.SECONDS_PER_SLOT;
    const nextEpochStartSec = this.chain.genesisTime + nextEpoch * secPerEpoch;
    const msToNextEpoch = nextEpochStartSec * 1000 - Date.now();
    if (msToNextEpoch > 0 && msToNextEpoch < MAX_API_CLOCK_DISPARITY_MS) {
      await this.chain.clock.waitForSlot(computeStartSlotAtEpoch(this.config, nextEpoch));
    }
  }

  /**
   * Reject any request while the node is syncing
   */
  private notWhileSyncing(): void {
    // Consider node synced before or close to genesis
    if (this.chain.clock.currentSlot < this.config.params.SLOTS_PER_EPOCH) {
      return;
    }

    const syncState = this.sync.state;
    switch (syncState) {
      case SyncState.SyncingFinalized:
      case SyncState.SyncingHead: {
        const currentSlot = this.chain.clock.currentSlot;
        const headSlot = this.chain.forkChoice.getHead().slot;
        if (currentSlot - headSlot > SYNC_TOLERANCE_EPOCHS * this.config.params.SLOTS_PER_EPOCH) {
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
}
