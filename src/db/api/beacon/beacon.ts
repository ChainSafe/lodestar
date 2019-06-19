/**
 * @module db/api/beacon
 */

import {
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  BeaconState,
  bytes32,
  Deposit,
  ProposerSlashing,
  Slot,
  Transfer,
  uint64, ValidatorIndex,
  VoluntaryExit
} from "../../../types";

import {Bucket, encodeKey, Key} from "../../schema";

import {AnySSZType, deserialize, hashTreeRoot, serialize} from "@chainsafe/ssz";
import {DatabaseService, DatabaseApiOptions} from "../abstract";
import {IBeaconDb} from "./interface";

export class BeaconDB extends DatabaseService implements IBeaconDb {

  public constructor(opts: DatabaseApiOptions) {
    super(opts);
  }

  public async getState(): Promise<BeaconState> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.state));
    return deserialize(buf, BeaconState);
  }

  public async setState(state: BeaconState): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.state), serialize(state, BeaconState));
  }

  public async getFinalizedState(): Promise<BeaconState> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.finalizedState));
    return deserialize(buf, BeaconState);
  }

  public async setFinalizedState(state: BeaconState): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.chainInfo, Key.finalizedState),
      serialize(state, BeaconState)
    );
  }

  public async setJustifiedState(state: BeaconState): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.chainInfo, Key.justifiedState),
      serialize(state, BeaconState)
    );
  }

  public async getJustifiedState(): Promise<BeaconState> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.justifiedState));
    return deserialize(buf, BeaconState);
  }

  public async getBlock(blockRoot: bytes32): Promise<BeaconBlock> {
    const buf = await this.db.get(encodeKey(Bucket.block, blockRoot));
    return deserialize(buf, BeaconBlock);
  }

  public async hasBlock(blockHash: bytes32): Promise<boolean> {
    try {
      await this.getBlock(blockHash);
      return true;
    } catch (e) {
      return false;
    }
  }

  public async getBlockRoot(slot: Slot): Promise<bytes32> {
    return await this.db.get(encodeKey(Bucket.mainChain, slot));
  }

  public async getBlockBySlot(slot: Slot): Promise<BeaconBlock> {
    const blockRoot = await this.getBlockRoot(slot);
    return await this.getBlock(blockRoot);
  }

  public async setBlock(block: BeaconBlock): Promise<void> {
    const blockRoot = hashTreeRoot(block, BeaconBlock);
    await this.db.put(encodeKey(Bucket.block, blockRoot), serialize(block, BeaconBlock));
  }

  public async getFinalizedBlock(): Promise<BeaconBlock> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.finalizedBlock));
    return deserialize(buf, BeaconBlock);
  }

  public async setFinalizedBlock(block: BeaconBlock): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.chainInfo, Key.finalizedBlock),
      serialize(block, BeaconBlock)
    );
  }

  public async getJustifiedBlock(): Promise<BeaconBlock> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.justifiedBlock));
    return deserialize(buf, BeaconBlock);
  }

  public async setJustifiedBlock(block: BeaconBlock): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.chainInfo, Key.justifiedBlock),
      serialize(block, BeaconBlock)
    );
  }

  public async getChainHeadSlot(): Promise<Slot> {
    const heightBuf = await this.db.get(encodeKey(Bucket.chainInfo, Key.chainHeight));
    return deserialize(heightBuf, uint64) as Slot;
  }

  public async getChainHeadRoot(): Promise<bytes32> {
    const slot  = await this.getChainHeadSlot();
    return await this.getBlockRoot(slot);
  }

  public async getChainHead(): Promise<BeaconBlock> {
    const blockRoot = await this.getChainHeadRoot();
    return await this.getBlock(blockRoot);
  }

  public async setChainHead(state: BeaconState, block: BeaconBlock): Promise<void> {
    const blockRoot = hashTreeRoot(block, BeaconBlock);
    const slot = block.slot;
    // block should already be set
    if(!await this.getBlock(blockRoot)) {
      throw new Error("block should be saved already");
    }
    await this.db.batchPut([
      {
        key: encodeKey(Bucket.mainChain, slot),
        value: blockRoot
      },
      {
        key: encodeKey(Bucket.chainInfo, Key.chainHeight),
        value: serialize(slot, uint64)
      },
      {
        key: encodeKey(Bucket.chainInfo, Key.state),
        value: serialize(state, BeaconState)
      }
    ]);
  }

  public async getAttestations(): Promise<Attestation[]> {
    return await this.getAllData(Bucket.attestation, Attestation);
  }

  public async getAttestation(root: bytes32): Promise<Attestation> {
    return await this.db.get(encodeKey(Bucket.attestation, root));
  }

  public async setAttestation(attestation: Attestation): Promise<void> {
    const attestationRoot = hashTreeRoot(attestation, Attestation);
    await this.db.put(
      encodeKey(Bucket.attestation, attestationRoot),
      serialize(attestation, Attestation)
    );
  }

  public async deleteAttestations(attestations: Attestation[]): Promise<void> {
    return await this.deleteData(Bucket.attestation, Attestation, attestations);
  }

  public async getVoluntaryExits(): Promise<VoluntaryExit[]> {
    return await this.getAllData(Bucket.exit, VoluntaryExit);
  }

  public async setVoluntaryExit(exit: VoluntaryExit): Promise<void> {
    const exitRoot = hashTreeRoot(exit, VoluntaryExit);
    await this.db.put(encodeKey(Bucket.exit, exitRoot), serialize(exit, VoluntaryExit));
  }

  public async deleteVoluntaryExits(exits: VoluntaryExit[]): Promise<void> {
    await this.deleteData(Bucket.exit, VoluntaryExit, exits);
  }

  public async getTransfers(): Promise<Transfer[]> {
    return await this.getAllData(Bucket.transfer, Transfer);
  }

  public async setTransfer(transfer: Transfer): Promise<void> {
    const transferRoot = hashTreeRoot(transfer, Transfer);
    await this.db.put(encodeKey(Bucket.transfer, transferRoot), serialize(transfer, Transfer));
  }

  public async deleteTransfers(transfers: Transfer[]): Promise<void> {
    await this.deleteData(Bucket.transfer, Transfer, transfers);
  }

  public async getProposerSlashings(): Promise<ProposerSlashing[]> {
    return await this.getAllData(Bucket.proposerSlashing, ProposerSlashing);
  }

  public async setProposerSlashing(proposerSlashing: ProposerSlashing): Promise<void> {
    const proposerSlashingRoot = hashTreeRoot(proposerSlashing, ProposerSlashing);
    await this.db.put(encodeKey(Bucket.proposerSlashing, proposerSlashingRoot),
      serialize(proposerSlashing, ProposerSlashing));
  }

  public async deleteProposerSlashings(proposerSlashings: ProposerSlashing[]): Promise<void> {
    await this.deleteData(Bucket.proposerSlashing, ProposerSlashing, proposerSlashings);
  }

  public async getAttesterSlashings(): Promise<AttesterSlashing[]> {
    return await this.getAllData(Bucket.attesterSlashing, AttesterSlashing);
  }

  public async setAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<void> {
    const attesterSlashingRoot = hashTreeRoot(attesterSlashing, AttesterSlashing);
    await this.db.put(encodeKey(Bucket.attesterSlashing, attesterSlashingRoot),
      serialize(attesterSlashing, AttesterSlashing));
  }

  public async deleteAttesterSlashings(attesterSlashings: AttesterSlashing[]): Promise<void> {
    await this.deleteData(Bucket.attesterSlashing, AttesterSlashing, attesterSlashings);
  }

  public async getGenesisDeposits(): Promise<Deposit[]> {
    return await this.getAllData(Bucket.genesisDeposit, Deposit);
  }

  public async setGenesisDeposit(deposit: Deposit): Promise<void> {
    await this.db.put(encodeKey(Bucket.genesisDeposit, deposit.index), serialize(deposit, Deposit));
  }

  public async deleteGenesisDeposits(deposits: Deposit[]): Promise<void> {
    const criteria: (Buffer | string)[] = deposits.map((deposit) => {
      return encodeKey(Bucket.genesisDeposit, deposit.index);
    });
    await this.db.batchDelete(criteria);
  }

  private async getAllData(key: Bucket, type: AnySSZType): Promise<any[]> {
    const data = await this.db.search({
      gt: encodeKey(key, Buffer.alloc(0)),
      lt: encodeKey(key + 1, Buffer.alloc(0)),
    });
    return data.map((data) => deserialize(data, type));
  }

  private async deleteData(key: Bucket, type: AnySSZType, data: any[]): Promise<void> {
    const criteria: any[] = [];
    data.forEach((n) =>
      criteria.push(encodeKey(key, hashTreeRoot(n, type)))
    );
    await this.db.batchDelete(criteria);
  }

  public async getValidatorIndex(publicKey: Buffer): Promise<ValidatorIndex> {
    const state = await this.getState();
    //TODO: cache this (hashmap)
    return state.validatorRegistry.findIndex(value => value.pubkey === publicKey);
  }

}
