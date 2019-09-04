import {
  Attestation,
  AttestationData,
  BeaconBlock,
  BLSPubkey,
  bytes,
  Deposit,
  Epoch,
  Eth1Data,
  IndexedAttestation,
  number64,
  Shard,
  Slot,
  ValidatorDuty,
  ValidatorIndex
} from "@chainsafe/eth2.0-types";

import {getEmptyBlock} from "../../../../src/chain/genesis/genesis";

import {IValidatorApi} from "../../../../src/api/rpc/api/validator";
import {CommitteeAssignment} from "../../../../src/validator/types";
import {ApiNamespace} from "../../../../src/api";

export interface MockValidatorAPIOpts {
  head?: BeaconBlock;
  chainId?: number64;
  validatorIndex?: ValidatorIndex;
  pendingAttestations?: Attestation[];
  getPendingDeposits?: Deposit[];
  Eth1Data?: Eth1Data;
  attestationData?: AttestationData;
}

export class MockValidatorApi implements IValidatorApi {
  public namespace: ApiNamespace;
  private chainId: number64;
  private validatorIndex: ValidatorIndex;
  private attestations;
  private head: BeaconBlock;

  public constructor(opts?: MockValidatorAPIOpts) {
    this.namespace = ApiNamespace.VALIDATOR;
    this.attestations = opts && opts.pendingAttestations || [];
    this.head = opts && opts.head || getEmptyBlock();
    this.chainId = opts && opts.chainId || 0;
    this.validatorIndex = opts && opts.validatorIndex || 1;
  }

  public async getDuties(validatorPublicKeys: BLSPubkey[]): Promise<ValidatorDuty[]> {
    return [];
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes): Promise<BeaconBlock> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as BeaconBlock;
  }

  public async publishBlock(block: BeaconBlock): Promise<void> {
    this.head = block;
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    this.attestations.push(attestation);
  }

  public produceAttestation(validatorPubKey: Buffer, pocBit: boolean, slot: number, shard: number): Promise<Attestation> {
    return undefined;
  }

}
