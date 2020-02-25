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
  ValidatorIndex,
  SignedBeaconBlock,
  CommitteeIndex,
  Epoch,
  BLSSignature
} from "@chainsafe/lodestar-types";

import {getEmptySignedBlock} from "../../../../src/chain/genesis/genesis";

import {IValidatorApi} from "../../../../src/api/rpc/api/validator";
import {ApiNamespace} from "../../../../src/api";
import { generateEmptyAttestation } from "../../attestation";

export interface MockValidatorAPIOpts {
  head?: SignedBeaconBlock;
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
  private attestations: Attestation[];
  private head: SignedBeaconBlock;

  public constructor(opts?: MockValidatorAPIOpts) {
    this.namespace = ApiNamespace.VALIDATOR;
    this.attestations = opts && opts.pendingAttestations || [];
    this.head = opts && opts.head || getEmptySignedBlock();
    this.chainId = opts && opts.chainId || 0;
    this.validatorIndex = opts && opts.validatorIndex || 1;
  }

  public async getProposerDuties(epoch: Epoch): Promise<Map<Slot, BLSPubkey>> {
    return new Map();
  }

  public async getAttesterDuties(epoch: Epoch, validatorPubKey: BLSPubkey[]): Promise<ValidatorDuty[]> {
    return [];
  }

  public async isAggregator(slot: Slot, committeeIndex: CommitteeIndex, slotSignature: BLSSignature): Promise<boolean> {
    return false;
  }

  public async publishAggregatedAttestation(
    aggregated: Attestation, validatorPubKey: BLSPubkey, slotSignature: BLSSignature
  ): Promise<void> {
    // do nothing
  }

  public async getWireAttestations(epoch: Epoch, committeeIndex: CommitteeIndex): Promise<Attestation[]> {
    return [];
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes): Promise<BeaconBlock> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as BeaconBlock;
  }

  public async publishBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    this.head = signedBlock;
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    this.attestations.push(attestation);
  }

  public async produceAttestation(validatorPubKey: Buffer, pocBit: boolean, slot: number, shard: number): Promise<Attestation> {
    return generateEmptyAttestation();
  }

  public async getValidatorIndex(pubKey: Buffer): Promise<ValidatorIndex> {
    return 0;
  }

}
