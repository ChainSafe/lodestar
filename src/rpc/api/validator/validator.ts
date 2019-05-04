import {
  Attestation, AttestationData, BeaconBlock, bytes32, Deposit, Shard, Slot, Eth1Data, uint64,
  Fork, SyncingStatus, ValidatorDuty, bytes48, bytes, IndexedAttestation, number64, BeaconState
} from "../../../types";
import {DB} from "../../../db";
import {BeaconChain} from "../../../chain";
import {OpPool} from "../../../opPool";

import {IValidatorApi} from "./interface";

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

  public async getClientVersion(): Promise<bytes32> {
    return Buffer.alloc(32);
  }

  public async getFork(): Promise<Fork> {
    const state: BeaconState = await this.db.getState();
    return state.fork;
  }

  public async getGenesisTime(): Promise<number64> {
    return await this.chain.genesisTime;
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as boolean | SyncingStatus;
  }

  public async getDuties(validatorPubkey: bytes48): Promise<{currentVersion: Fork; validatorDuty: ValidatorDuty}> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as {currentVersion: Fork; validatorDuty: ValidatorDuty};
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes): Promise<BeaconBlock> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as BeaconBlock;
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
