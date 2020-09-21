/**
 * @module api/rpc
 */

import {toHexString} from "@chainsafe/ssz";
import {Signature, verify} from "@chainsafe/bls";
import {
  AggregateAndProof,
  Attestation,
  AttestationData,
  AttesterDuty,
  BeaconBlock,
  BLSPubkey,
  BLSSignature,
  Bytes96,
  CommitteeIndex,
  Epoch,
  ProposerDuty,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  Slot,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  computeSubnetForSlot,
  getDomain,
} from "@chainsafe/lodestar-beacon-state-transition";
import {assert, ILogger} from "@chainsafe/lodestar-utils";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";

import {IBeaconDb} from "../../../db";
import {IBeaconChain} from "../../../chain";
import {IApiOptions} from "../../options";
import {INetwork} from "../../../network";
import {IBeaconSync} from "../../../sync";
import {IEth1ForBlockProduction} from "../../../eth1";
import {DomainType, EMPTY_SIGNATURE} from "../../../constants";
import {assembleBlock} from "../../../chain/factory/block";
import {assembleAttesterDuty} from "../../../chain/factory/duties";
import {assembleAttestation} from "../../../chain/factory/attestation";
import {toGraffitiBuffer} from "../../../util/graffiti";
import {ApiError} from "../errors/api";
import {notNullish} from "../../../util/notNullish";
import {ApiNamespace, IApiModules} from "../interface";
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

  public async produceBlock(
    slot: Slot,
    validatorPubkey: BLSPubkey,
    randaoReveal: Bytes96,
    graffiti = ""
  ): Promise<BeaconBlock> {
    await this.checkSyncStatus();
    const validatorIndex = (await this.chain.getHeadEpochContext()).pubkey2index.get(validatorPubkey);
    if (validatorIndex === undefined) {
      throw Error(`Validator pubKey ${toHexString(validatorPubkey)} not in epochCtx`);
    }
    return await assembleBlock(
      this.config,
      this.chain,
      this.db,
      this.eth1,
      slot,
      validatorIndex,
      randaoReveal,
      toGraffitiBuffer(graffiti)
    );
  }

  public async produceAttestation(validatorPubKey: BLSPubkey, index: CommitteeIndex, slot: Slot): Promise<Attestation> {
    try {
      await this.checkSyncStatus();
      const [headBlockRoot, {state: headState, epochCtx}] = await Promise.all([
        this.chain.forkChoice.getHeadRoot(),
        this.chain.getHeadStateContext(),
      ]);
      const validatorIndex = epochCtx.pubkey2index.get(validatorPubKey);
      if (validatorIndex === undefined) {
        throw Error(`Validator pubKey ${toHexString(validatorPubKey)} not in epochCtx`);
      }
      const currentSlot = this.chain.clock.currentSlot;
      if (headState.slot < currentSlot) {
        processSlots(epochCtx, headState, currentSlot);
      }
      return await assembleAttestation(epochCtx, headState, headBlockRoot, validatorIndex, index, slot);
    } catch (e) {
      this.logger.warn(`Failed to produce attestation because: ${e.message}`);
      throw e;
    }
  }

  public async publishBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    await this.checkSyncStatus();
    await Promise.all([this.chain.receiveBlock(signedBlock), this.network.gossip.publishBlock(signedBlock)]);
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    await this.checkSyncStatus();
    //it could discard attestations that would can be valid a bit later
    // await validateGossipAttestation(
    //   this.config, this.db, headStateContext.epochCtx, headStateContext.state, attestation
    // );
    await Promise.all([
      this.network.gossip.publishCommiteeAttestation(attestation),
      this.db.attestation.add(attestation),
    ]);
  }

  public async getProposerDuties(epoch: Epoch): Promise<ProposerDuty[]> {
    await this.checkSyncStatus();
    assert.gte(epoch, 0, "Epoch must be positive");
    const {state, epochCtx} = await this.chain.getHeadStateContext();
    assert.lte(
      epoch,
      computeEpochAtSlot(this.config, state.slot) + 2,
      "Cannot get duties for epoch more than two ahead"
    );
    const startSlot = computeStartSlotAtEpoch(this.config, epoch);
    if (state.slot < startSlot) {
      processSlots(epochCtx, state, startSlot);
    }
    const duties: ProposerDuty[] = [];

    for (let slot = startSlot; slot < startSlot + this.config.params.SLOTS_PER_EPOCH; slot++) {
      const blockProposerIndex = epochCtx.getBeaconProposer(slot);
      duties.push({slot, proposerPubkey: state.validators[blockProposerIndex].pubkey});
    }
    return duties;
  }

  public async getAttesterDuties(epoch: number, validatorPubKeys: BLSPubkey[]): Promise<AttesterDuty[]> {
    await this.checkSyncStatus();
    if (!validatorPubKeys || validatorPubKeys.length === 0) throw new Error("No validator to get attester duties");
    const {epochCtx, state} = await this.chain.getHeadStateContext();
    const currentSlot = this.chain.clock.currentSlot;
    if (state.slot < currentSlot) {
      processSlots(epochCtx, state, currentSlot);
    }
    const validatorIndexes = validatorPubKeys.map((key) => {
      const validatorIndex = epochCtx.pubkey2index.get(key);
      if (validatorIndex === undefined || !Number.isInteger(validatorIndex)) {
        throw Error(`Validator pubKey ${toHexString(key)} not in epochCtx`);
      }
      return validatorIndex;
    });
    return validatorIndexes
      .map((validatorIndex) => {
        const validator = state.validators[validatorIndex];
        if (!validator) {
          throw Error(`Validator index ${validatorIndex} not in state`);
        }
        return assembleAttesterDuty(this.config, {publicKey: validator.pubkey, index: validatorIndex}, epochCtx, epoch);
      })
      .filter(notNullish) as AttesterDuty[];
  }

  public async publishAggregateAndProof(signedAggregateAndProof: SignedAggregateAndProof): Promise<void> {
    await this.checkSyncStatus();
    await Promise.all([
      this.db.aggregateAndProof.add(signedAggregateAndProof.message),
      this.network.gossip.publishAggregatedAttestation(signedAggregateAndProof),
    ]);
  }

  public async getWireAttestations(epoch: number, committeeIndex: number): Promise<Attestation[]> {
    return await this.db.attestation.getCommiteeAttestations(epoch, committeeIndex);
  }

  public async produceAggregateAndProof(
    attestationData: AttestationData,
    aggregator: BLSPubkey
  ): Promise<AggregateAndProof> {
    await this.checkSyncStatus();
    const attestations = await this.getWireAttestations(
      computeEpochAtSlot(this.config, attestationData.slot),
      attestationData.index
    );
    const epochCtx = await this.chain.getHeadEpochContext();
    const matchingAttestations = attestations.filter((a) => {
      return this.config.types.AttestationData.equals(a.data, attestationData);
    });

    if (matchingAttestations.length === 0) {
      throw Error("No matching attestations found for attestationData");
    }

    const aggregatorIndex = epochCtx.pubkey2index.get(aggregator);
    if (aggregatorIndex === undefined) {
      throw Error(`Aggregator pubkey ${toHexString(aggregator)} not in epochCtx`);
    }

    const aggregate = matchingAttestations.reduce((current, attestation) => {
      try {
        current.signature = Signature.fromCompressedBytes(current.signature.valueOf() as Uint8Array)
          .add(Signature.fromCompressedBytes(attestation.signature.valueOf() as Uint8Array))
          .toBytesCompressed();
        let index = 0;
        for (const bit of attestation.aggregationBits) {
          if (bit) {
            current.aggregationBits[index] = true;
          }
          index++;
        }
      } catch (e) {
        //ignored
      }
      return current;
    });

    const aggregateAndProof = {
      aggregate,
      aggregatorIndex,
      selectionProof: EMPTY_SIGNATURE,
    };

    await this.db.seenAttestationCache.addAggregateAndProof(aggregateAndProof);
    return aggregateAndProof;
  }

  public async subscribeCommitteeSubnet(
    slot: Slot,
    slotSignature: BLSSignature,
    committeeIndex: CommitteeIndex,
    aggregatorPubkey: BLSPubkey
  ): Promise<void> {
    await this.checkSyncStatus();
    const state = await this.chain.getHeadState();
    const domain = getDomain(this.config, state, DomainType.SELECTION_PROOF, computeEpochAtSlot(this.config, slot));
    const signingRoot = computeSigningRoot(this.config, this.config.types.Slot, slot, domain);
    const valid = verify(aggregatorPubkey.valueOf() as Uint8Array, signingRoot, slotSignature.valueOf() as Uint8Array);
    if (!valid) {
      throw new Error("Invalid slot signature");
    }
    await this.sync.collectAttestations(slot, committeeIndex);
    const subnet = computeSubnetForSlot(this.config, state, slot, committeeIndex);
    await this.network.searchSubnetPeers(String(subnet));
  }

  private async checkSyncStatus(): Promise<void> {
    if (!this.sync.isSynced()) {
      let syncStatus;
      try {
        syncStatus = await this.sync.getSyncStatus();
      } catch (e) {
        throw new ApiError(503, "Node is stopped");
      }
      if (syncStatus.syncDistance > this.config.params.SLOTS_PER_EPOCH) {
        throw new ApiError(
          503,
          `Node is syncing, status: ${JSON.stringify(this.config.types.SyncingStatus.toJson(syncStatus))}`
        );
      }
    }
  }
}
