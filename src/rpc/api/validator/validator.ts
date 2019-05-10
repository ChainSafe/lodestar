/**
 * @module rpc/api
 */

import {
  Attestation,
  AttestationData,
  BeaconBlock,
  BeaconState,
  bytes,
  bytes48,
  Epoch,
  Fork,
  Shard,
  Slot,
  ValidatorDuty,
  ValidatorIndex
} from "../../../types";
import {DB} from "../../../db";
import {BeaconChain} from "../../../chain";
import {OpPool} from "../../../opPool";

import {IValidatorApi} from "./interface";
import {getCommitteeAssignment, isProposerAtSlot} from "../../../chain/stateTransition/util";
import {CommitteeAssignment} from "../../../validator/types";

export class ValidatorApi implements IValidatorApi {
  public namespace: string;
  private chain: BeaconChain;
  private db: DB;
  private opPool: OpPool;

  public constructor(opts, {chain, db, opPool}) {
    this.namespace = "validator";
    this.chain = chain;
    this.db = db;
    this.opPool = opPool;
  }

  public async getDuties(validatorPubkey: bytes48): Promise<{currentVersion: Fork; validatorDuty: ValidatorDuty}> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as {currentVersion: Fork; validatorDuty: ValidatorDuty};
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes): Promise<BeaconBlock> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as BeaconBlock;
  }

  public async isProposer(index: ValidatorIndex, slot: Slot): Promise<boolean> {
    const state: BeaconState = await this.db.getState();
    return isProposerAtSlot(state, slot, index);
  }

  public async getCommitteeAssignment(index: ValidatorIndex, epoch: Epoch): Promise<CommitteeAssignment> {
    const state: BeaconState = await this.db.getState();
    return getCommitteeAssignment(state, epoch, index);
  }

  public async produceAttestation(slot: Slot, shard: Shard): Promise<AttestationData> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as AttestationData;
  }

  public async publishBlock(block: BeaconBlock): Promise<void> {
    await this.chain.receiveBlock(block);
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    await this.opPool.receiveAttestation(attestation);
  }
}
