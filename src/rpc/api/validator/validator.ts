/**
 * @module rpc/api
 */

import {
  Attestation,
  AttestationData,
  BeaconBlock,
  BeaconState,
  BLSPubkey,
  bytes,
  Epoch,
  Fork,
  Shard,
  Slot,
  ValidatorDuty,
  ValidatorIndex
} from "../../../types";
import {BeaconDB} from "../../../db";
import {BeaconChain} from "../../../chain";
import {OpPool} from "../../../opPool";
import ssz from "@chainsafe/ssz";
import {IValidatorApi} from "./interface";
import {getCommitteeAssignment, isProposerAtSlot} from "../../../chain/stateTransition/util";
import {CommitteeAssignment} from "../../../validator/types";

export class ValidatorApi implements IValidatorApi {
  public namespace: string;
  private chain: BeaconChain;
  private db: BeaconDB;
  private opPool: OpPool;

  public constructor(opts, {chain, db, opPool}) {
    this.namespace = "validator";
    this.chain = chain;
    this.db = db;
    this.opPool = opPool;
  }

  public async getDuties(validatorIndex: ValidatorIndex): Promise<{currentVersion: Fork; validatorDuty: ValidatorDuty}> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as {currentVersion: Fork; validatorDuty: ValidatorDuty};
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes): Promise<BeaconBlock> {
    const block: BeaconBlock = {
      body: undefined,
      previousBlockRoot: undefined,
      signature: undefined,
      slot: undefined,
      stateRoot: undefined
    };
    const prevBlock: BeaconBlock = await this.db.getChainHead();
    const curState: BeaconState = await this.db.getState();
    // Note: To calculate state_root,
    // the validator should first run the state transition function on an unsigned block
    // containing a stub for the state_root.
    // It is useful to be able to run a state transition function that does not
    // validate signatures or state root for this purpose.
    block.slot = slot;
    block.previousBlockRoot = ssz.hashTreeRoot(prevBlock, BeaconBlock);
    block.stateRoot = ssz.hashTreeRoot(curState, BeaconState);
    // TODO Eth1Data
    return block;
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

  public async getIndex(validatorPublicKey: BLSPubkey): Promise<ValidatorIndex> {
    const state = await this.db.getState();
    state.validatorRegistry.forEach((validator, index) => {
      if(validator.pubkey === validatorPublicKey) {
        return index;
      }
    });
    return null;
  }
}
