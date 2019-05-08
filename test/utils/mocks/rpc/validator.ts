import {
  Attestation,
  AttestationData,
  BeaconBlock,
  bytes,
  bytes32,
  bytes48,
  Deposit,
  Epoch,
  Eth1Data,
  Fork,
  number64,
  Shard,
  Slot,
  SyncingStatus,
  ValidatorDuty,
  ValidatorIndex
} from "../../../../src/types";

import {getEmptyBlock} from "../../../../src/chain/genesis";

import {IValidatorApi} from "../../../../src/rpc/api/validator";
import {CommitteeAssignment} from "../../../../src/validator/types";

export interface MockValidatorAPIOpts {
  head?: BeaconBlock;
  chainId?: number64;
  pendingAttestations?: Attestation[];
  getPendingDeposits?: Deposit[];
  Eth1Data?: Eth1Data;
  attestationData?: AttestationData;
}

export class MockValidatorApi implements IValidatorApi {
  public namespace: string;
  private chainId: number64;
  private attestations;
  private head: BeaconBlock;
  public constructor(opts?: MockValidatorAPIOpts) {
    this.namespace = "validator";
    this.attestations = opts && opts.pendingAttestations || [];
    this.head = opts && opts.head || getEmptyBlock();
    this.chainId = opts && opts.chainId || 0;
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
