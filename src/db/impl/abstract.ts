import {EventEmitter} from "events";
import {DB} from "../interface";
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
  uint64,
  VoluntaryExit
} from "../../types";

import {Bucket, encodeKey, Key} from "../schema";

import {deserialize, hashTreeRoot, serialize} from "@chainsafe/ssz";

export interface SearchOptions {
  gt: any;
  lt: any;
}

export default abstract class AbstractDB extends EventEmitter implements DB {
  public abstract get(key: any): Promise<any>;

  public abstract batchPut(items: { key: any; value: any }[]): Promise<any>;

  public abstract batchDelete(items: any[]): Promise<any>;

  /**
     * Should return items which has key prefix >= opts.gt && prefix < opt.lt
     * @param opts
     */
  public abstract search(opts: SearchOptions): Promise<any[]>;

  /**
     * Should insert or update
     * @param key
     * @param value
     */
  public abstract put(key: any, value: any): Promise<any>;

  public abstract start(): Promise<void>;

  public abstract stop(): Promise<void>;

  public async getState(): Promise<BeaconState> {
    const buf = await this.get(encodeKey(Bucket.chainInfo, Key.state));
    return deserialize(buf, BeaconState);
  }

  public async setState(state: BeaconState): Promise<void> {
    await this.put(encodeKey(Bucket.chainInfo, Key.state), serialize(state, BeaconState));
  }

  public async getFinalizedState(): Promise<BeaconState> {
    const buf = await this.get(encodeKey(Bucket.chainInfo, Key.finalizedState));
    return deserialize(buf, BeaconState);
  }

  public async setJustifiedState(state: BeaconState): Promise<void> {
    await this.put(encodeKey(Bucket.chainInfo, Key.justifiedState), serialize(state, BeaconState));
  }

  public async getJustifiedState(): Promise<BeaconState> {
    const buf = await this.get(encodeKey(Bucket.chainInfo, Key.justifiedState));
    return deserialize(buf, BeaconState);
  }

  public async setFinalizedState(state: BeaconState): Promise<void> {
    await this.put(encodeKey(Bucket.chainInfo, Key.finalizedState), serialize(state, BeaconState));
  }

  public async getBlock(blockRoot: bytes32): Promise<BeaconBlock> {
    const buf = await this.get(encodeKey(Bucket.block, blockRoot));
    return deserialize(buf, BeaconBlock);
  }

  public async hasBlock(blockHash: bytes32): Promise<boolean> {
    try {
      return !!this.getBlock(blockHash);
    } catch (e) {
      return false;
    }
  }

  public async getBlockBySlot(slot: Slot): Promise<BeaconBlock> {
    const blockRoot = await this.get(encodeKey(Bucket.mainChain, slot));
    return await this.getBlock(blockRoot);
  }

  public async setBlock(block: BeaconBlock): Promise<void> {
    const blockRoot = hashTreeRoot(block, BeaconBlock);
    await this.put(encodeKey(Bucket.block, blockRoot), serialize(block, BeaconBlock));
  }

  public async getFinalizedBlock(): Promise<BeaconBlock> {
    const buf = await this.get(encodeKey(Bucket.chainInfo, Key.finalizedBlock));
    return deserialize(buf, BeaconBlock);
  }

  public async setFinalizedBlock(block: BeaconBlock): Promise<void> {
    await this.put(encodeKey(Bucket.chainInfo, Key.finalizedBlock), serialize(block, BeaconBlock));
  }

  public async getJustifiedBlock(): Promise<BeaconBlock> {
    const buf = await this.get(encodeKey(Bucket.chainInfo, Key.justifiedBlock));
    return deserialize(buf, BeaconBlock);
  }

  public async setJustifiedBlock(block: BeaconBlock): Promise<void> {
    await this.put(encodeKey(Bucket.chainInfo, Key.justifiedBlock), serialize(block, BeaconBlock));
  }

  public async getChainHead(): Promise<BeaconBlock> {
    const heightBuf = await this.get(encodeKey(Bucket.chainInfo, Key.chainHeight));
    const height = deserialize(heightBuf, uint64);
    const blockRoot = await this.get(encodeKey(Bucket.mainChain, height));
    return await this.getBlock(blockRoot);
  }

  public async getChainHeadRoot(): Promise<bytes32> {
    const block = await this.getChainHead();
    return hashTreeRoot(block, BeaconBlock);
  }

  public async setChainHead(state: BeaconState, block: BeaconBlock): Promise<void> {
    const blockRoot = hashTreeRoot(block, BeaconBlock);
    const slot = block.slot;
    // block should already be set
    await this.getBlock(blockRoot);
    await this.batchPut([
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
    const data = await this.search({
      gt: encodeKey(Bucket.attestation, Buffer.alloc(0)),
      lt: encodeKey(Bucket.attestation + 1, Buffer.alloc(0)),
    });
    return data.map((data) => deserialize(data, Attestation));
  }

  public async setAttestation(attestation: Attestation): Promise<void> {
    const attestationRoot = hashTreeRoot(attestation, Attestation);
    await this.put(encodeKey(Bucket.attestation, attestationRoot), serialize(attestation, Attestation));
  }

  public async deleteAttestations(attestations: Attestation[]): Promise<void> {
    const criteria: any[] = [];
    attestations.forEach((n) =>
      criteria.push(encodeKey(Bucket.attestation, hashTreeRoot(n, Attestation)))
    );
    await this.batchDelete(criteria);
  }

  public async getVoluntaryExits(): Promise<VoluntaryExit[]> {
    const data = await this.search({
      gt: encodeKey(Bucket.exit, Buffer.alloc(0)),
      lt: encodeKey(Bucket.exit + 1, Buffer.alloc(0)),
    });
    return data.map((data) => deserialize(data, VoluntaryExit));
  }

  public async setVoluntaryExit(exit: VoluntaryExit): Promise<void> {
    const exitRoot = hashTreeRoot(exit, VoluntaryExit);
    await this.put(encodeKey(Bucket.exit, exitRoot), serialize(exit, VoluntaryExit));
  }

  public async deleteVoluntaryExits(exits: VoluntaryExit[]): Promise<void> {
    const criteria: any[] = [];
    exits.forEach((n) =>
      criteria.push(encodeKey(Bucket.exit, hashTreeRoot(n, VoluntaryExit)))
    );
    await this.batchDelete(criteria);
  }

  public async getTransfers(): Promise<Transfer[]> {
    const data = await this.search({
      gt: encodeKey(Bucket.transfer, Buffer.alloc(0)),
      lt: encodeKey(Bucket.transfer + 1, Buffer.alloc(0)),
    });
    return data.map((data) => deserialize(data, Transfer));
  }

  public async setTransfer(transfer: Transfer): Promise<void> {
    const transferRoot = hashTreeRoot(transfer, Transfer);
    await this.put(encodeKey(Bucket.transfer, transferRoot), serialize(transfer, Transfer));
  }

  public async deleteTransfers(transfers: Transfer[]): Promise<void> {
    const criteria: any[] = [];
    transfers.forEach((n) =>
      criteria.push(encodeKey(Bucket.transfer, hashTreeRoot(n, Transfer)))
    );
    await this.batchDelete(criteria);
  }

  public async getProposerSlashings(): Promise<ProposerSlashing[]> {
    const data = await this.search({
      gt: encodeKey(Bucket.proposerSlashing, Buffer.alloc(0)),
      lt: encodeKey(Bucket.proposerSlashing + 1, Buffer.alloc(0)),
    });
    return data.map((data) => deserialize(data, ProposerSlashing));
  }

  public async setProposerSlashing(proposerSlashing: ProposerSlashing): Promise<void> {
    const proposerSlashingRoot = hashTreeRoot(proposerSlashing, ProposerSlashing);
    await this.put(encodeKey(Bucket.proposerSlashing, proposerSlashingRoot), serialize(proposerSlashing, ProposerSlashing));
  }

  public async deleteProposerSlashings(proposerSlashings: ProposerSlashing[]): Promise<void> {
    const criteria: any[] = [];
    proposerSlashings.forEach((n) =>
      criteria.push(encodeKey(Bucket.proposerSlashing, hashTreeRoot(n, ProposerSlashing)))
    );
    await this.batchDelete(criteria);
  }

  public async getAttesterSlashings(): Promise<AttesterSlashing[]> {
    const data = await this.search({
      gt: encodeKey(Bucket.attesterSlashing, Buffer.alloc(0)),
      lt: encodeKey(Bucket.attesterSlashing + 1, Buffer.alloc(0)),
    });
    return data.map((data) => deserialize(data, AttesterSlashing));
  }

  public async setAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<void> {
    const attesterSlashingRoot = hashTreeRoot(attesterSlashing, AttesterSlashing);
    await this.put(encodeKey(Bucket.attesterSlashing, attesterSlashingRoot), serialize(attesterSlashing, AttesterSlashing));
  }

  public async deleteAttesterSlashings(attesterSlashings: AttesterSlashing[]): Promise<void> {
    const criteria: any[] = [];
    attesterSlashings.forEach((n) =>
      criteria.push(encodeKey(Bucket.attesterSlashing, hashTreeRoot(n, AttesterSlashing)))
    );
    await this.batchDelete(criteria);
  }

  public async getGenesisDeposits(): Promise<Deposit[]> {
    const data = await this.search({
      gt: encodeKey(Bucket.genesisDeposit, Buffer.alloc(0)),
      lt: encodeKey(Bucket.genesisDeposit + 1, Buffer.alloc(0)),
    });
    return data.map((data) => deserialize(data, Deposit));
  }

  public async setGenesisDeposit(deposit: Deposit): Promise<void> {
    await this.put(encodeKey(Bucket.genesisDeposit, deposit.index), serialize(deposit, Deposit));
  }

  public async deleteGenesisDeposits(deposits: Deposit[]): Promise<void> {
    const criteria: any[] = [];
    deposits.forEach((deposit) =>
      criteria.push(encodeKey(Bucket.genesisDeposit, deposit.index))
    );
    await this.batchDelete(criteria);
  }

}
