/**
 * @module api/rpc
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

import {BeaconDb} from "../../../../db";
import {BeaconChain} from "../../../../chain";
import {OpPool} from "../../../../opPool";
import {IValidatorApi} from "./interface";
import {getCommitteeAssignment, isProposerAtSlot} from "../../../../chain/stateTransition/util";
import {CommitteeAssignment} from "../../../../validator/types";
import {assembleBlock} from "../../../../chain/factory/block";
import {IEth1Notifier} from "../../../../eth1";
import {getValidatorDuties, produceAttestation} from "../../../impl/validator";
import {ApiNamespace} from "../../../index";

export class ValidatorApi implements IValidatorApi {

  public namespace: ApiNamespace;

  private config: IBeaconConfig;
  private chain: BeaconChain;
  private db: BeaconDb;
  private opPool: OpPool;
  private eth1: IEth1Notifier;

  public constructor(opts, {config, chain, db, opPool, eth1}) {
    this.namespace = ApiNamespace.VALIDATOR;
    this.config = config;
    this.chain = chain;
    this.db = db;
    this.opPool = opPool;
    this.eth1 = eth1;
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes96): Promise<BeaconBlock> {
    return await assembleBlock(this.config, this.db, this.opPool, this.eth1, slot, randaoReveal);
  }

  public async getDuties(validatorPublicKeys: BLSPubkey[], epoch: Epoch): Promise<ValidatorDuty[]> {
    return getValidatorDuties(this.config, this.db, validatorPublicKeys, epoch);
  }

  public async produceAttestation(validatorPubKey: BLSPubkey, pocBit: boolean, slot: Slot, shard: Shard): Promise<Attestation> {
    return produceAttestation(
      {config: this.config, chain: this.chain, db: this.db},
      validatorPubKey,
      shard,
      slot
    );
  }

  public async publishBlock(block: BeaconBlock): Promise<void> {
    await this.chain.receiveBlock(block);
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    await this.opPool.attestations.receive(attestation);
  }

}
