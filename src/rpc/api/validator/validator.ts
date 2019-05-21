/**
 * @module rpc/api
 */

import {
  Attestation,
  AttestationData,
  BeaconBlock,
  BeaconBlockBody,
  BeaconState,
  BLSPubkey,
  bytes96,
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
import {
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS
} from "../../../constants";
import {assembleBlock} from "../../../chain/blockAssembly";

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

  public async produceBlock(slot: Slot, randaoReveal: bytes96): Promise<BeaconBlock> {
    return await assembleBlock(this.db, this.opPool, slot, randaoReveal);
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
