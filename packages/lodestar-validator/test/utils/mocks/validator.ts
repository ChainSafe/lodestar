/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Attestation,
  AttestationData,
  BeaconBlock,
  BLSPubkey,
  bytes,
  Deposit,
  Eth1Data,
  number64,
  Slot,
  ValidatorDuty,
  ValidatorIndex
} from "@chainsafe/eth2.0-types";
import {IValidatorApi} from "../../../src/rpc/api/validators";
import {getEmptyBlock} from "@chainsafe/lodestar/lib/chain/genesis/genesis";

export interface IMockValidatorAPIOpts {
  head?: BeaconBlock;
  chainId?: number64;
  validatorIndex?: ValidatorIndex;
  pendingAttestations?: Attestation[];
  getPendingDeposits?: Deposit[];
  Eth1Data?: Eth1Data;
  attestationData?: AttestationData;
}

export class MockValidatorApi implements IValidatorApi {
  private chainId: number64;
  private validatorIndex: ValidatorIndex;
  private attestations: Attestation[];
  private head: BeaconBlock;

  public constructor(opts?: IMockValidatorAPIOpts) {
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

  public getValidatorIndex(pubKey: Buffer): Promise<ValidatorIndex> {
    return undefined;
  }

}
