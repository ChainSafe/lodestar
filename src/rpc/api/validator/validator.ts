/**
 * @module rpc/api
 */

import {
  Attestation,
  BeaconBlock,
  BeaconState,
  BLSPubkey,
  bytes96,
  Epoch,
  IndexedAttestation,
  Shard,
  Slot,
  ValidatorDuty,
  ValidatorIndex
} from "../../../types";
import {BeaconDB} from "../../../db";
import {BeaconChain} from "../../../chain";
import {OpPool} from "../../../opPool";
import {IValidatorApi} from "./interface";
import {
  getBeaconProposerIndex,
  getCommitteeAssignment,
  isProposerAtSlot
} from "../../../chain/stateTransition/util";
import {CommitteeAssignment} from "../../../validator/types";
import {assembleBlock} from "../../../chain/factory/block";
import {assembleAttestation} from "../../../chain/factory/attestation";
import {assembleValidatorDuty} from "../../../chain/factory/duties";
import {IEth1Notifier} from "../../../eth1";

export class ValidatorApi implements IValidatorApi {

  public namespace: string;
  private chain: BeaconChain;
  private db: BeaconDB;
  private opPool: OpPool;
  private eth1: IEth1Notifier;

  public constructor(opts, {chain, db, opPool, eth1}) {
    this.namespace = "validator";
    this.chain = chain;
    this.db = db;
    this.opPool = opPool;
    this.eth1 = eth1;
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes96): Promise<BeaconBlock> {
    return await assembleBlock(this.db, this.opPool, this.eth1, slot, randaoReveal);
  }

  public async isProposer(index: ValidatorIndex, slot: Slot): Promise<boolean> {
    const state: BeaconState = await this.db.getLatestState();
    return isProposerAtSlot(state, slot, index);
  }

  public async getDuties(validatorPublicKeys: Buffer[]): Promise<ValidatorDuty[]> {
    const state = await this.db.getLatestState();

    const validatorIndexes = await Promise.all(validatorPublicKeys.map(async publicKey => {
      return  await this.db.getValidatorIndex(publicKey);
    }));

    const blockProposerIndex = getBeaconProposerIndex(state);

    return validatorPublicKeys.map(
      (validatorPublicKey, index) => {
        const validatorIndex = validatorIndexes[index];
        return assembleValidatorDuty(validatorPublicKey, validatorIndex, state, blockProposerIndex);
      }
    );
  }

  public async getCommitteeAssignment(
    index: ValidatorIndex,
    epoch: Epoch): Promise<CommitteeAssignment> {
    const state: BeaconState = await this.db.getLatestState();
    return getCommitteeAssignment(state, epoch, index);
  }

  public async produceAttestation(slot: Slot, shard: Shard): Promise<IndexedAttestation> {
    const [headState, headBlock] = await Promise.all([
      this.db.getLatestState(),
      this.db.getBlock(this.chain.forkChoice.head())
    ]);
    return await assembleAttestation(this.db, headState, headBlock, shard, slot);
  }

  public async publishBlock(block: BeaconBlock): Promise<void> {
    await this.chain.receiveBlock(block);
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    await this.opPool.attestations.receive(attestation);
  }

  public async getIndex(validatorPublicKey: BLSPubkey): Promise<ValidatorIndex> {
    return await this.db.getValidatorIndex(validatorPublicKey);
  }
}
