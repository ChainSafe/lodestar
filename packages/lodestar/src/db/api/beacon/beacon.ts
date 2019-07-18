/**
 * @module db/api/beacon
 */

import {
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  BeaconState,
  bytes32,
  Deposit, MerkleTree,
  ProposerSlashing,
  Slot,
  Transfer,
  uint64, ValidatorIndex,
  VoluntaryExit,
  number64
} from "../../../types";

import {Bucket, encodeKey, Key} from "../../schema";

import {AnySSZType, deserialize, hashTreeRoot, serialize} from "@chainsafe/ssz";
import {DatabaseService, DatabaseApiOptions} from "../abstract";
import {IBeaconDb} from "./interface";
import {IProgressiveMerkleTree, ProgressiveMerkleTree} from "../../../util/merkleTree";

export class BeaconDB extends DatabaseService implements IBeaconDb {

  public constructor(opts: DatabaseApiOptions) {
    super(opts);
  }

  public async getState(root: bytes32): Promise<BeaconState | null> {
    try {
      const buf = await this.db.get(encodeKey(Bucket.state, root));
      return deserialize(buf, this.config.types.BeaconState);
    } catch (e) {
      return null;
    }
  }

  public async setState(root: bytes32, state: BeaconState): Promise<void> {
    await this.db.put(encodeKey(Bucket.state, root), serialize(state, this.config.types.BeaconState));
  }

  /**
   * Blocks and states can be referred to by root in the chain info bucket
   */
  private async getRefValue<T>(key: Key, getFn: (r: bytes32) => T | null): Promise<T | null> {
    const root = await this.db.get(encodeKey(Bucket.chainInfo, key));
    return await getFn(deserialize(root, this.config.types.bytes32));
  }
  private async setRef(key: Key, root: bytes32): Promise<void> {
    await this.db.put(
      encodeKey(Bucket.chainInfo, key),
      serialize(root, this.config.types.bytes32)
    );
  }

  public async getLatestState(): Promise<BeaconState | null> {
    return await this.getRefValue<BeaconState>(Key.latestState, this.getState.bind(this));
  }

  public async setLatestStateRoot(root: bytes32, state?: BeaconState): Promise<void> {
    return await this.setRef(Key.latestState, root);
  }

  public async getFinalizedState(): Promise<BeaconState> {
    return await this.getRefValue<BeaconState>(Key.finalizedState, this.getState.bind(this));
  }

  public async setFinalizedStateRoot(root: bytes32, state?: BeaconState): Promise<void> {
    return await this.setRef(Key.finalizedState, root);
  }

  public async getJustifiedState(): Promise<BeaconState> {
    return await this.getRefValue<BeaconState>(Key.justifiedState, this.getState.bind(this));
  }

  public async setJustifiedStateRoot(root: bytes32, state?: BeaconState): Promise<void> {
    return await this.setRef(Key.justifiedState, root);
  }

  public async getBlock(root: bytes32): Promise<BeaconBlock | null> {
    try {
      const buf = await this.db.get(encodeKey(Bucket.block, root));
      return deserialize(buf, this.config.types.BeaconBlock);
    } catch (e) {
      return null;
    }
  }

  public async hasBlock(root: bytes32): Promise<boolean> {
    return !!await this.getBlock(root);
  }

  public async setBlock(root: bytes32, block: BeaconBlock): Promise<void> {
    await this.db.put(encodeKey(Bucket.block, root), serialize(block, this.config.types.BeaconBlock));
  }

  public async getFinalizedBlock(): Promise<BeaconBlock | null> {
    return await this.getRefValue<BeaconBlock>(Key.finalizedBlock, this.getBlock.bind(this));
  }

  public async setFinalizedBlockRoot(root: bytes32, block?: BeaconBlock): Promise<void> {
    return await this.setRef(Key.finalizedBlock, root);
  }

  public async getJustifiedBlock(): Promise<BeaconBlock | null> {
    return await this.getRefValue<BeaconBlock>(Key.justifiedBlock, this.getBlock.bind(this));
  }

  public async setJustifiedBlockRoot(root: bytes32, block?: BeaconBlock): Promise<void> {
    return await this.setRef(Key.justifiedBlock, root);
  }

  public async getBlockRoot(slot: Slot): Promise<bytes32 | null> {
    try {
      return await this.db.get(encodeKey(Bucket.mainChain, slot));
    } catch (e) {
      return null;
    }
  }

  public async getBlockBySlot(slot: Slot): Promise<BeaconBlock | null> {
    const root = await this.getBlockRoot(slot);
    if (root === null) {
      return null;
    }
    return await this.getBlock(root);
  }
  public async getChainHeadSlot(): Promise<Slot | null> {
    try {
      const heightBuf = await this.db.get(encodeKey(Bucket.chainInfo, Key.chainHeight));
      return deserialize(heightBuf, this.config.types.uint64) as Slot;
    } catch (e) {
      return null;
    }
  }

  public async getChainHeadRoot(): Promise<bytes32 | null> {
    const slot  = await this.getChainHeadSlot();
    if (slot === null) {
      return null;
    }
    return await this.getBlockRoot(slot);
  }

  public async getChainHead(): Promise<BeaconBlock> {
    const root = await this.getChainHeadRoot();
    if (root === null) {
      return null;
    }
    return await this.getBlock(root);
  }

  public async setChainHeadRoots(blockRoot: bytes32, stateRoot: bytes32, block?: BeaconBlock, state?: BeaconState): Promise<void> {
    const [storedBlock, storedState] = await Promise.all([
      block ? block : this.getBlock(blockRoot),
      state ? state : this.getState(stateRoot),
    ]);
    // block should already be set
    if(!storedBlock) {
      throw new Error("unknown block root");
    }
    // state should already be set
    if(!storedState) {
      throw new Error("unknown state root");
    }
    const slot = block.slot;
    await Promise.all([
      this.setLatestStateRoot(block.stateRoot, storedState),
      this.db.batchPut([{
        key: encodeKey(Bucket.mainChain, slot),
        value: blockRoot
      }, {
        key: encodeKey(Bucket.chainInfo, Key.chainHeight),
        value: serialize(slot, this.config.types.uint64)
      }]),
    ]);
  }

  public async getAttestations(): Promise<Attestation[]> {
    return await this.getAllData(Bucket.attestation, this.config.types.Attestation);
  }

  public async getAttestation(root: bytes32): Promise<Attestation> {
    return deserialize(await this.db.get(encodeKey(Bucket.attestation, root)), this.config.types.Attestation);
  }

  public async hasAttestation(root: bytes32): Promise<boolean> {
    try {
      await this.getAttestation(root);
      return true;
    } catch (e) {
      return false;
    }
  }

  public async setAttestation(attestation: Attestation): Promise<void> {
    const attestationRoot = hashTreeRoot(attestation, this.config.types.Attestation);
    await this.db.put(
      encodeKey(Bucket.attestation, attestationRoot),
      serialize(attestation, this.config.types.Attestation)
    );
  }

  public async deleteAttestations(attestations: Attestation[]): Promise<void> {
    return await this.deleteData(Bucket.attestation, this.config.types.Attestation, attestations);
  }

  public async getVoluntaryExits(): Promise<VoluntaryExit[]> {
    return await this.getAllData(Bucket.exit, this.config.types.VoluntaryExit);
  }

  public async setVoluntaryExit(exit: VoluntaryExit): Promise<void> {
    const exitRoot = hashTreeRoot(exit, this.config.types.VoluntaryExit);
    await this.db.put(encodeKey(Bucket.exit, exitRoot), serialize(exit, this.config.types.VoluntaryExit));
  }

  public async deleteVoluntaryExits(exits: VoluntaryExit[]): Promise<void> {
    await this.deleteData(Bucket.exit, this.config.types.VoluntaryExit, exits);
  }

  public async getTransfers(): Promise<Transfer[]> {
    return await this.getAllData(Bucket.transfer, this.config.types.Transfer);
  }

  public async setTransfer(transfer: Transfer): Promise<void> {
    const transferRoot = hashTreeRoot(transfer, this.config.types.Transfer);
    await this.db.put(encodeKey(Bucket.transfer, transferRoot), serialize(transfer, this.config.types.Transfer));
  }

  public async deleteTransfers(transfers: Transfer[]): Promise<void> {
    await this.deleteData(Bucket.transfer, this.config.types.Transfer, transfers);
  }

  public async getProposerSlashings(): Promise<ProposerSlashing[]> {
    return await this.getAllData(Bucket.proposerSlashing, this.config.types.ProposerSlashing);
  }

  public async setProposerSlashing(proposerSlashing: ProposerSlashing): Promise<void> {
    const proposerSlashingRoot = hashTreeRoot(proposerSlashing, this.config.types.ProposerSlashing);
    await this.db.put(encodeKey(Bucket.proposerSlashing, proposerSlashingRoot),
      serialize(proposerSlashing, this.config.types.ProposerSlashing));
  }

  public async deleteProposerSlashings(proposerSlashings: ProposerSlashing[]): Promise<void> {
    await this.deleteData(Bucket.proposerSlashing, this.config.types.ProposerSlashing, proposerSlashings);
  }

  public async getAttesterSlashings(): Promise<AttesterSlashing[]> {
    return await this.getAllData(Bucket.attesterSlashing, this.config.types.AttesterSlashing);
  }

  public async setAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<void> {
    const attesterSlashingRoot = hashTreeRoot(attesterSlashing, this.config.types.AttesterSlashing);
    await this.db.put(encodeKey(Bucket.attesterSlashing, attesterSlashingRoot),
      serialize(attesterSlashing, this.config.types.AttesterSlashing));
  }

  public async deleteAttesterSlashings(attesterSlashings: AttesterSlashing[]): Promise<void> {
    await this.deleteData(Bucket.attesterSlashing, this.config.types.AttesterSlashing, attesterSlashings);
  }

  public async getDeposits(): Promise<Deposit[]> {
    return await this.getAllData(Bucket.deposit, this.config.types.Deposit);
  }

  public async setDeposit(index: number, deposit: Deposit): Promise<void> {
    await this.db.put(encodeKey(Bucket.deposit, index), serialize(deposit, this.config.types.Deposit));
  }

  public async deleteDeposits(index: number): Promise<void> {
    const criteria = Array.from(
      {length: index},
      (_, index) => {
        return encodeKey(Bucket.deposit, index);
      }
    );
    await this.db.batchDelete(criteria);
  }

  private async getAllData(key: Bucket, type: AnySSZType): Promise<any[]> {
    const data = await this.db.search({
      gt: encodeKey(key, Buffer.alloc(0)),
      lt: encodeKey(key + 1, Buffer.alloc(0)),
    });
    return (data || []).map((data) => deserialize(data, type));
  }

  private async deleteData(key: Bucket, type: AnySSZType, data: any[]): Promise<void> {
    const criteria: any[] = [];
    data.forEach((n) =>
      criteria.push(encodeKey(key, hashTreeRoot(n, type)))
    );
    await this.db.batchDelete(criteria);
  }

  public async getValidatorIndex(publicKey: Buffer): Promise<ValidatorIndex> {
    const state = await this.getLatestState();
    //TODO: cache this (hashmap)
    return state.validatorRegistry.findIndex(value => value.pubkey === publicKey);
  }

  public async getMerkleTree(index: number): Promise<IProgressiveMerkleTree | null> {
    const merkleTreeSerialized = await this.db.get(
      encodeKey(Bucket.merkleTree, index)
    );
    if(merkleTreeSerialized) {
      return ProgressiveMerkleTree.deserialize(merkleTreeSerialized);
    }
    return null;
  }

  public async setMerkleTree(index: number, merkleTree: IProgressiveMerkleTree): Promise<void> {
    return this.db.put(
      encodeKey(Bucket.merkleTree, index),
      merkleTree.serialize()
    );
  }

  public async setBadBlockRoot(root: bytes32): Promise<void> {
    return await this.db.put(encodeKey(Bucket.invalidBlock, root),
      serialize(root, this.config.types.bytes32));
  }
  public async isBadBlockRoot(root: bytes32): Promise<boolean> {
    try {
      await this.db.get(encodeKey(Bucket.invalidBlock, root));
      return true;
    }catch (e) {
      return false;
    }
  }

}
