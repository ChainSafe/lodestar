import {
  Attestation, AttestationData, BeaconBlock, bytes32, Deposit, Shard, Slot, Eth1Data, uint64,
  Fork, SyncingStatus, ValidatorDuty, bytes48, bytes, IndexedAttestation
} from "../../../types";
import {DB} from "../../../db";
import {BeaconChain} from "../../../chain";
import {OpPool} from "../../../opPool";

import {IValidatorApi} from "../interfaces";

export class ValidatorApi implements IValidatorApi {
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

  public async getFork(): Promise<{fork: Fork; chainId: uint64}> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as {fork: Fork; chainId: uint64};
  }

  public async getGenesisTime(): Promise<uint64> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as uint64;
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as boolean | SyncingStatus;
  }

  public async getDuties(validatorPubkeys: bytes48[]): Promise<{currentVersion: Fork; validatorDuties: ValidatorDuty[]}> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as {currentVersion: Fork; validatorDuties: ValidatorDuty[]};
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes): Promise<BeaconBlock> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as BeaconBlock;
  }

  public async produceAttestation(slot: Slot, shard: Shard): Promise<IndexedAttestation> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as IndexedAttestation;
  }

  public async publishBlock(beaconBlock: BeaconBlock): Promise<void> {}

  public async publishAttestation(indexedAttestation: IndexedAttestation): Promise<void> {}
}
