import {
  Attestation, AttestationData, BeaconBlock, bytes32, Deposit, Shard, Slot, Eth1Data,
  BeaconState, ValidatorIndex, Epoch
} from "../../../../src/types";

import {getEmptyBlock} from "../../../../src/chain/genesis";

import {IValidatorApi} from "../../../../src/rpc/api/validator";
import {bytes, bytes48, Fork, number64, SyncingStatus, uint64, ValidatorDuty} from "../../../../src/types";
import {getCommitteeAssignment, isProposerAtSlot} from "../../../../src/chain/stateTransition/util";
import {CommitteeAssignment} from "../../../../src/validator/types";

export interface MockAPIOpts {
  head?: BeaconBlock;
  version?: bytes32;
  fork?: Fork;
  chainId?: number64;
  pendingAttestations?: Attestation[];
  getPendingDeposits?: Deposit[];
  Eth1Data?: Eth1Data;
  attestationData?: AttestationData;
}

export class MockValidatorApi implements IValidatorApi {
  public namespace: string;
  private version: bytes32;
  private fork: Fork;
  private chainId: number64;
  private attestations;
  private head: BeaconBlock;
  public constructor(opts?: MockAPIOpts) {
    this.namespace = "validator";
    this.attestations = opts && opts.pendingAttestations || [];
    this.head = opts && opts.head || getEmptyBlock();
    this.version = opts && opts.version || Buffer.alloc(0);
    this.fork = opts && opts.fork || {previousVersion: Buffer.alloc(0), currentVersion: Buffer.alloc(0), epoch: 0}
    this.chainId = opts && opts.chainId || 0;
  }

  public async getClientVersion(): Promise<bytes32> {
    return this.version;
  }

  public async getFork(): Promise<Fork> {
    return this.fork;
  }

  public async getGenesisTime(): Promise<number64> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as number64;
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    return false;
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

  public async isProposer(index: ValidatorIndex, slot: Slot): Promise<boolean> {
    return true;
  }

  public async getCommitteeAssignment(index: ValidatorIndex, epoch: Epoch): Promise<CommitteeAssignment> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as CommitteeAssignment;
  }

  public async publishBlock(block: BeaconBlock): Promise<void> {
    this.head = block;
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    this.attestations.push(Attestation);
  }

}
