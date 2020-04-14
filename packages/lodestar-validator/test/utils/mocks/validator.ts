/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  AggregateAndProof,
  Attestation,
  AttestationData,
  AttesterDuty,
  BeaconBlock,
  BLSPubkey,
  Deposit,
  Eth1Data,
  Number64,
  ProposerDuty,
  SignedBeaconBlock,
  ValidatorIndex
} from "@chainsafe/lodestar-types";
import {IValidatorApi} from "../../../src/api/interface/validators";
import {generateEmptyBlock} from "../block";

export interface IMockValidatorAPIOpts {
  head?: SignedBeaconBlock;
  chainId?: Number64;
  validatorIndex?: ValidatorIndex;
  pendingAttestations?: Attestation[];
  getPendingDeposits?: Deposit[];
  Eth1Data?: Eth1Data;
  attestationData?: AttestationData;
}

export class MockValidatorApi implements IValidatorApi {
  private chainId: Number64;
  private validatorIndex: ValidatorIndex;
  private attestations: Attestation[];
  private head: SignedBeaconBlock;

  public constructor(opts?: IMockValidatorAPIOpts) {
    this.attestations = opts && opts.pendingAttestations || [];
    this.head = opts && opts.head || {message: generateEmptyBlock(), signature: Buffer.alloc(96)};
    this.chainId = opts && opts.chainId || 0;
    this.validatorIndex = opts && opts.validatorIndex || 1;
  }

  public async produceAggregatedAttestation(attestationData: AttestationData): Promise<Attestation> {
    throw new Error("Method not implemented.");
  }

  getAttesterDuties(epoch: number, validatorPubKey: BLSPubkey[]): Promise<AttesterDuty[]> {
    return undefined;
  }

  getProposerDuties(epoch: number): Promise<ProposerDuty[]> {
    return undefined;
  }

  getWireAttestations(epoch: number, committeeIndex: number): Promise<Attestation[]> {
    return undefined;
  }

  isAggregator(slot: number, committeeIndex: number, slotSignature: Buffer): Promise<boolean> {
    return undefined;
  }

  produceAttestation(validatorPubKey: Buffer, index: number, slot: number): Promise<Attestation> {
    return undefined;
  }

  produceBlock(slot: number, randaoReveal: Buffer): Promise<BeaconBlock> {
    return undefined;
  }

  publishAggregatedAttestation(aggregated: AggregateAndProof): Promise<void> {
    return undefined;
  }

  publishAttestation(attestation: Attestation): Promise<void> {
    return undefined;
  }

  publishBlock(beaconBlock: SignedBeaconBlock): Promise<void> {
    return undefined;
  }

  subscribeCommitteeSubnet(
    slot: number, slotSignature: Buffer, committeeIndex: number, aggregatorPubkey: Buffer
  ): Promise<void> {
    return undefined;
  }
}
