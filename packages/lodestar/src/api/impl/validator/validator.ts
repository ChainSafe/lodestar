/**
 * @module api/rpc
 */

import bls, {Signature} from "@chainsafe/bls";
import {
  CachedBeaconState,
  computeStartSlotAtEpoch,
  computeSubnetForCommitteesAtSlot,
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
import {INetwork} from "../../../network";
import {IBeaconSync} from "../../../sync";
import {toGraffitiBuffer} from "../../../util/graffiti";
import {IApiOptions} from "../../options";
import {ApiError} from "../errors";
import {ApiNamespace, IApiModules} from "../interface";
import {checkSyncStatus} from "../utils";
import {IValidatorApi} from "./interface";

/**
 * 2 Slots is likely excessive but our node single thread can get very overloaded.
 * Once we are certain that long periods of thread blocking don't happen, reduce to 1.
 */
const MAX_SLOT_DIFF_WAIT = 2;

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
  private logger: ILogger;
  // Cached for duties
  private genesisBlockRoot: Root | null = null;

  constructor(
    opts: Partial<IApiOptions>,
    modules: Pick<IApiModules, "config" | "chain" | "db" | "eth1" | "sync" | "network" | "logger">
  ) {
    this.namespace = ApiNamespace.VALIDATOR;
    this.config = modules.config;
    this.chain = modules.chain;
    this.db = modules.db;
    this.eth1 = modules.eth1;
    this.network = modules.network;
    this.sync = modules.sync;
    this.logger = modules.logger;
  }

  async produceBlock(slot: Slot, randaoReveal: Bytes96, graffiti = ""): Promise<phase0.BeaconBlock> {
    await checkSyncStatus(this.config, this.sync);
    await this.waitForRequestedSlot(slot);

    return await assembleBlock(
      this.config,
      this.chain,
      this.db,
      this.eth1,
      slot,
      randaoReveal,
      toGraffitiBuffer(graffiti)
    );
  }

  async produceAttestationData(committeeIndex: CommitteeIndex, slot: Slot): Promise<phase0.AttestationData> {
    await checkSyncStatus(this.config, this.sync);
    await this.waitForRequestedSlot(slot);

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
    await checkSyncStatus(this.config, this.sync);

    const startSlot = computeStartSlotAtEpoch(this.config, epoch);
    await this.waitForRequestedSlot(startSlot);

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
    await checkSyncStatus(this.config, this.sync);

    if (validatorIndices.length === 0) {
      throw new ApiError(400, "No validator to get attester duties");
    }

    await this.waitForRequestedSlot(computeStartSlotAtEpoch(this.config, epoch));

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
    await checkSyncStatus(this.config, this.sync);
    await this.waitForRequestedSlot(slot);

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
    await checkSyncStatus(this.config, this.sync);
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
    await checkSyncStatus(this.config, this.sync);

    // Determine if the validator is an aggregator. If so, we subscribe to the subnet and
    // if successful add the validator to a mapping of known aggregators for that exact
    // subnet.
    for (const {isAggregator, slot, committeeIndex} of subscriptions) {
      if (isAggregator) {
        this.sync.collectAttestations(slot, committeeIndex);
      }
    }

    this.network.requestAttSubnets(
      subscriptions.map(({slot, committeesAtSlot, committeeIndex}) => ({
        subnetId: computeSubnetForCommitteesAtSlot(this.config, slot, committeesAtSlot, committeeIndex),
        // Network should keep finding peers for this subnet until `toSlot`
        // add one slot to ensure we keep the peer for the subscription slot
        toSlot: slot + 1,
      }))
    );

    // TODO:
    // Update the `known_validators` mapping and subscribes to a set of random subnets if required
    // It must also update the ENR to indicate our long-lived subscription to the subnet

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
   * Validator client's clock may not be in sync with beacon's clock. Wait for the request slot
   */
  private async waitForRequestedSlot(slot: Slot): Promise<void> {
    // Store currentSlot as variable to ensure it's the same in the if conditions
    const currentSlot = this.chain.clock.currentSlot;
    if (slot > currentSlot && slot <= currentSlot + MAX_SLOT_DIFF_WAIT) {
      await this.chain.clock.waitForSlot(slot);
    }
  }
}
