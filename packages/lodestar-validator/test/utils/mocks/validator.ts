/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Attestation,
  AttestationData,
  BeaconBlock,
  BLSPubkey,
  Deposit,
  Eth1Data,
  Number64,
  Slot,
  ValidatorDuty,
  ValidatorIndex,
  SignedBeaconBlock
} from "@chainsafe/lodestar-types";
import {IValidatorApi} from "../../../src/api/interface/validators";
import {generateEmptyBlock} from "../../utils/block";

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

  getAttesterDuties(epoch: number, validatorPubKey: BLSPubkey[]): Promise<ValidatorDuty[]> {
    return undefined;
  }

  getProposerDuties(epoch: number): Promise<Map<Slot, BLSPubkey>> {
    return undefined;
  }

  getWireAttestations(epoch: number, committeeIndex: number): Promise<Attestation[]> {
    return undefined;
  }

  isAggregator(slot: number, committeeIndex: number, slotSignature: Buffer): Promise<boolean> {
    return undefined;
  }

  produceAttestation(validatorPubKey: Buffer, pocBit: boolean, index: number, slot: number): Promise<Attestation> {
    return undefined;
  }

  produceBlock(slot: number, randaoReveal: Buffer): Promise<BeaconBlock> {
    return undefined;
  }

  publishAggregatedAttestation(aggregated: Attestation, validatorPubKey: Buffer, slotSignature: Buffer): Promise<void> {
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
