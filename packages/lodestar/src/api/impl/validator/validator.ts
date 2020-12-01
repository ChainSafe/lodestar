/**
 * @module api/rpc
 */

import bls, {Signature} from "@chainsafe/bls";
import {computeStartSlotAtEpoch, computeSubnetForCommitteesAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  Attestation,
  AttestationData,
  AttesterDuty,
  BeaconBlock,
  Bytes96,
  CommitteeIndex,
  Epoch,
  ProposerDuty,
  Root,
  SignedAggregateAndProof,
  Slot,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {assert, ILogger} from "@chainsafe/lodestar-utils";
import {readOnlyForEach} from "@chainsafe/ssz";
import {IAttestationJob, IBeaconChain} from "../../../chain";
import {assembleAttestationData} from "../../../chain/factory/attestation";
import {assembleBlock} from "../../../chain/factory/block";
import {assembleAttesterDuty} from "../../../chain/factory/duties";
import {validateGossipAggregateAndProof} from "../../../chain/validation";
import {IBeaconDb} from "../../../db";
import {IEth1ForBlockProduction} from "../../../eth1";
import {INetwork} from "../../../network";
import {IBeaconSync} from "../../../sync";
import {toGraffitiBuffer} from "../../../util/graffiti";
import {notNullish} from "../../../util/notNullish";
import {IApiOptions} from "../../options";
import {ApiError} from "../errors/api";
import {ApiNamespace, IApiModules} from "../interface";
import {checkSyncStatus} from "../utils";
import {IValidatorApi} from "./interface";

export class ValidatorApi implements IValidatorApi {
  public namespace: ApiNamespace;

  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private db: IBeaconDb;
  private eth1: IEth1ForBlockProduction;
  private network: INetwork;
  private sync: IBeaconSync;
  private logger: ILogger;

  public constructor(
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

  public async produceBlock(slot: Slot, randaoReveal: Bytes96, graffiti = ""): Promise<BeaconBlock> {
    await checkSyncStatus(this.config, this.sync);
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

  public async produceAttestationData(committeeIndex: CommitteeIndex, slot: Slot): Promise<AttestationData> {
    try {
      await checkSyncStatus(this.config, this.sync);
      const headRoot = this.chain.forkChoice.getHeadRoot();
      const {state, epochCtx} = await this.chain.regen.getBlockSlotState(headRoot, slot);
      return await assembleAttestationData(epochCtx.config, state, headRoot, slot, committeeIndex);
    } catch (e) {
      this.logger.warn(`Failed to produce attestation data because: ${e.message}`);
      throw e;
    }
  }

  public async getProposerDuties(epoch: Epoch): Promise<ProposerDuty[]> {
    await checkSyncStatus(this.config, this.sync);
    assert.gte(epoch, 0, "Epoch must be positive");
    assert.lte(epoch, this.chain.clock.currentEpoch, "Must get proposer duties in current epoch");
    const {state, epochCtx} = await this.chain.getHeadStateContextAtCurrentEpoch();
    const startSlot = computeStartSlotAtEpoch(this.config, epoch);
    const duties: ProposerDuty[] = [];

    for (let slot = startSlot; slot < startSlot + this.config.params.SLOTS_PER_EPOCH; slot++) {
      const blockProposerIndex = epochCtx.getBeaconProposer(slot);
      duties.push({slot, validatorIndex: blockProposerIndex, pubkey: state.validators[blockProposerIndex].pubkey});
    }
    return duties;
  }

  public async getAttesterDuties(epoch: number, validatorIndices: ValidatorIndex[]): Promise<AttesterDuty[]> {
    await checkSyncStatus(this.config, this.sync);
    if (validatorIndices.length === 0) throw new ApiError(400, "No validator to get attester duties");
    if (epoch > this.chain.clock.currentEpoch + 1)
      throw new ApiError(400, "Cannot get duties for epoch more than one ahead");
    const {epochCtx, state} = await this.chain.getHeadStateContextAtCurrentEpoch();
    return validatorIndices
      .map((validatorIndex) => {
        const validator = state.validators[validatorIndex];
        if (!validator) {
          throw new ApiError(400, `Validator index ${validatorIndex} not in state`);
        }
        return assembleAttesterDuty(this.config, {pubkey: validator.pubkey, index: validatorIndex}, epochCtx, epoch);
      })
      .filter(notNullish) as AttesterDuty[];
  }

  public async getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<Attestation> {
    await checkSyncStatus(this.config, this.sync);
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
        readOnlyForEach(attestation.aggregationBits, (bit, index) => {
          if (bit) {
            aggregationBits[index] = true;
          }
        });
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

  public async publishAggregateAndProofs(signedAggregateAndProofs: SignedAggregateAndProof[]): Promise<void> {
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
            this.network.gossip.publishAggregatedAttestation(signedAggregateAndProof),
          ]);
        } catch (e) {
          this.logger.warn("Failed to publish aggregate and proof", {reason: e.message});
        }
      })
    );
  }

  public async prepareBeaconCommitteeSubnet(
    validatorIndex: ValidatorIndex,
    committeeIndex: CommitteeIndex,
    committeesAtSlot: number,
    slot: Slot,
    isAggregator: boolean
  ): Promise<void> {
    await checkSyncStatus(this.config, this.sync);
    if (isAggregator) {
      await this.sync.collectAttestations(slot, committeeIndex);
    }
    const subnet = computeSubnetForCommitteesAtSlot(this.config, slot, committeesAtSlot, committeeIndex);
    await this.network.searchSubnetPeers(String(subnet));
  }
}
