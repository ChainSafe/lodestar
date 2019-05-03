import {Attestation, AttestationData, BeaconBlock, bytes32, Deposit, Shard, Slot, Eth1Data} from "../../../types/index";

import {getEmptyBlock} from "../../../chain/genesis";

import {IValidatorApi} from "../interfaces/index";
import {bytes, bytes48, Fork, number64, SyncingStatus, uint64, ValidatorDuty} from "../../../types";

export interface MockAPIOpts {
  head?: BeaconBlock;
  pendingAttestations?: Attestation[];
  getPendingDeposits?: Deposit[];
  Eth1Data?: Eth1Data;
  attestationData?: AttestationData;
}

export class MockAPI implements IValidatorApi {
  private version: bytes32;
  private fork: Fork;
  private chainId: number64;
  private attestations;
  private head: BeaconBlock;
  public constructor(opts?: MockAPIOpts) {
    this.attestations = opts && opts.pendingAttestations || [];
    this.head = opts && opts.head || getEmptyBlock();
  }
  public async getClientVersion(): Promise<bytes32> {
    return this.version;
  }

  public async getFork(): Promise<{fork: Fork; chainId: number64}> {
    return {fork: this.fork, chainId: this.chainId};
  }

  public async getGenesisTime(): Promise<number64> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as number64;
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    return false;
  }

  public async getDuties(validatorPubkeys: bytes48[]): Promise<{currentVersion: Fork; validatorDuties: ValidatorDuty[]}> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as {currentVersion: Fork; validatorDuties: ValidatorDuty[]};
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
    this.head = block;
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    this.attestations.push(Attestation);
  }

}
