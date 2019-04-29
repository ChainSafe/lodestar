import {Attestation, AttestationData, BeaconBlock, bytes32, Deposit, Shard, Slot, Eth1Data} from "../../types";
import {DB} from "../../db";
import {BeaconChain} from "../../chain";
import {OpPool} from "../../opPool";

import {API} from "./interface"; 

export class BeaconAPI implements API {
  private chain: BeaconChain;
  private db: DB;
  private opPool: OpPool;

  public constructor(opts, {chain, db, opPool}) {
    this.chain = chain;
    this.db = db;
    this.opPool = opPool;
  }

  public async getChainHead(): Promise<BeaconBlock> {
    return await this.db.getChainHead();
  }

  public async getPendingAttestations(): Promise<Attestation[]> {
    return this.opPool.getAttestations();
  }

  public async getPendingDeposits(): Promise<Deposit[]> {
    return [];
  }

  public async getEth1Data(): Promise<Eth1Data> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as Eth1Data;
  }

  public async computeStateRoot(block: BeaconBlock): Promise<bytes32> {
    return Buffer.alloc(32);
  }

  public async getAttestationData(slot: Slot, shard: Shard): Promise<AttestationData> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as AttestationData;
  }

  public async putAttestation(attestation: Attestation): Promise<void> {
    await this.opPool.receiveAttestation(attestation);
  }

  public async putBlock(block: BeaconBlock): Promise<void> {
    await this.chain.receiveBlock(block);
  }
}
