import {
  Attestation, AttestationData, BeaconBlock, bytes32, Deposit, Shard, Slot, Eth1Data, uint64,
  Fork, SyncingStatus, ValidatorDuty, bytes48, bytes
} from "../../types";
import { DB } from "../../db";
import { BeaconChain } from "../../chain";
import { OpPool } from "../../opPool";

import {API} from "./interface";

export class ValidatorAPI implements API {
  private chain: BeaconChain;
  private db: DB;
  private opPool: OpPool;

  public constructor(opts, {chain, db, opPool}) {
    this.chain = chain;
    this.db = db;
    this.opPool = opPool;
  }

  public async getClientVersion(): Promise<bytes32> {
    return Buffer.alloc(32);
  }

  public async getFork(): Promise<{fork: Fork, chain_id: uint64}> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as {fork: Fork, chain_id: uint64};
  }

  public async getGenesisTime(): Promise<uint64> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as uint64;
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as boolean | SyncingStatus;
  }

  public async getDuties(validator_pubkeys: bytes48[]): Promise<{current_version: Fork, validator_duties: ValidatorDuty[]}> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as {current_version: Fork, validator_duties: ValidatorDuty[]};
  }

  public async produceBlock(slot: Slot, randao_reveal: bytes): Promise<BeaconBlock> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as BeaconBlock;
  }

  public async produceAttestation(slot: Slot, shard: Shard): Promise<IndexedAttestation> {
    // await this.opPool.receiveAttestation(attestation);
  }

  public async publishBlock(beacon_block: BeaconBlock): Promise<void> {
    // await this.chain.receiveBlock(block);
  }

  public async publishAttestation(indexed_attestation: IndexedAttestation): Promise<void> {
    // await this.chain.receiveBlock(block);
  }
}
