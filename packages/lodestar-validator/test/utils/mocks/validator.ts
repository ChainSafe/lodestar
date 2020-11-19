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
  SignedAggregateAndProof,
  SignedBeaconBlock,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {generateEmptyBlock} from "@chainsafe/lodestar/test/utils/block";
import {IValidatorApi} from "../../../src/api/interface/validators";

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
    this.attestations = (opts && opts.pendingAttestations) || [];
    this.head = (opts && opts.head) || {message: generateEmptyBlock(), signature: Buffer.alloc(96)};
    this.chainId = (opts && opts.chainId) || 0;
    this.validatorIndex = (opts && opts.validatorIndex) || 1;
  }

  public async produceAggregateAndProof(
    attestationData: AttestationData,
    aggregator: BLSPubkey
  ): Promise<AggregateAndProof> {
    throw new Error("Method not implemented.");
  }

  getAttesterDuties(epoch: number, validatorPubKey: ValidatorIndex[]): Promise<AttesterDuty[]> {
    throw Error("not implemented");
  }

  getProposerDuties(epoch: number): Promise<ProposerDuty[]> {
    throw Error("not implemented");
  }

  getWireAttestations(epoch: number, committeeIndex: number): Promise<Attestation[]> {
    throw Error("not implemented");
  }

  produceAttestation(validatorPubKey: Buffer, index: number, slot: number): Promise<Attestation> {
    throw Error("not implemented");
  }

  produceBlock(slot: number, randaoReveal: Buffer, graffiti?: string): Promise<BeaconBlock> {
    throw Error("not implemented");
  }

  publishAggregateAndProof(signedAggregateAndProof: SignedAggregateAndProof): Promise<void> {
    throw Error("not implemented");
  }

  publishAttestation(attestation: Attestation): Promise<void> {
    throw Error("not implemented");
  }

  subscribeCommitteeSubnet(
    slot: number,
    slotSignature: Buffer,
    committeeIndex: number,
    aggregatorPubkey: Buffer
  ): Promise<void> {
    throw Error("not implemented");
  }
}
