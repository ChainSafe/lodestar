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
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {IBeaconDb} from "../../../db";
import {IBeaconChain} from "../../../chain";
import {OpPool} from "../../../opPool";
import {IValidatorApi} from "./interface";
import {getBeaconProposerIndex, getCommitteeAssignment, isProposerAtSlot} from "../../../chain/stateTransition/util";
import {CommitteeAssignment} from "../../../validator/types";
import {assembleBlock} from "../../../chain/factory/block";
import {assembleAttestation} from "../../../chain/factory/attestation";
import {assembleValidatorDuty} from "../../../chain/factory/duties";
import {IEth1Notifier} from "../../../eth1";
import {IApiModules} from "../interface";

export class ValidatorApi implements IValidatorApi {

  public namespace: string;
  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private db: IBeaconDb;
  private opPool: OpPool;
  private eth1: IEth1Notifier;

  public constructor(opts: {}, {config, chain, db, opPool, eth1}: IApiModules) {
    this.namespace = "validator";
    this.config = config;
    this.chain = chain;
    this.db = db;
    this.opPool = opPool;
    this.eth1 = eth1;
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes96): Promise<BeaconBlock|null> {
    return await assembleBlock(this.config, this.db, this.opPool, this.eth1, slot, randaoReveal);
  }

  public async isProposer(index: ValidatorIndex, slot: Slot): Promise<boolean> {
    const state = await this.db.state.getLatest();
    return isProposerAtSlot(this.config, state, slot, index);
  }

  public async getDuties(validatorPublicKeys: Buffer[]): Promise<ValidatorDuty[]> {
    const state = await this.db.state.getLatest();

    const validatorIndexes = await Promise.all(validatorPublicKeys.map(async publicKey => {
      return  await this.db.getValidatorIndex(publicKey);
    }));

    const blockProposerIndex = getBeaconProposerIndex(this.config, state);

    return validatorPublicKeys.map(
      (validatorPublicKey, index) => {
        const validatorIndex = validatorIndexes[index];
        if(!validatorIndex) return null;
        return assembleValidatorDuty(this.config, validatorPublicKey, validatorIndex, state, blockProposerIndex);
      }
    ).filter((duty) => !!duty) as ValidatorDuty[];
  }

  public async getCommitteeAssignment(
    index: ValidatorIndex,
    epoch: Epoch): Promise<CommitteeAssignment> {
    const state: BeaconState = await this.db.state.getLatest();
    return getCommitteeAssignment(this.config, state, epoch, index);
  }

  public async produceAttestation(slot: Slot, shard: Shard): Promise<IndexedAttestation> {
    const [headState, headBlock] = await Promise.all([
      this.db.state.getLatest(),
      this.db.block.get(this.chain.forkChoice.head())
    ]);
    return await assembleAttestation(this.config, this.db, headState, headBlock as BeaconBlock, shard, slot);
  }

  public async publishBlock(block: BeaconBlock): Promise<void> {
    await this.chain.receiveBlock(block);
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    await this.opPool.attestations.receive(attestation);
  }

  public async getIndex(validatorPublicKey: BLSPubkey): Promise<ValidatorIndex|null> {
    return await this.db.getValidatorIndex(validatorPublicKey);
  }
}
