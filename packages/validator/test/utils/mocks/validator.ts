/* eslint-disable @typescript-eslint/no-unused-vars */
import {Number64, phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {generateEmptyBlock} from "@chainsafe/lodestar/test/utils/block";
import {IValidatorApi} from "../../../src/api/interface/validators";

export interface IMockValidatorAPIOpts {
  head?: phase0.SignedBeaconBlock;
  chainId?: Number64;
  validatorIndex?: ValidatorIndex;
  pendingAttestations?: phase0.Attestation[];
  getPendingDeposits?: phase0.Deposit[];
  eth1Data?: phase0.Eth1Data;
  attestationData?: phase0.AttestationData;
}

export class MockValidatorApi implements IValidatorApi {
  private chainId: Number64;
  private validatorIndex: ValidatorIndex;
  private attestations: phase0.Attestation[];
  private head: phase0.SignedBeaconBlock;

  constructor(opts?: IMockValidatorAPIOpts) {
    this.attestations = (opts && opts.pendingAttestations) || [];
    this.head = (opts && opts.head) || {message: generateEmptyBlock(), signature: Buffer.alloc(96)};
    this.chainId = (opts && opts.chainId) || 0;
    this.validatorIndex = (opts && opts.validatorIndex) || 1;
  }
  produceAttestationData(index: number, slot: number): Promise<phase0.AttestationData> {
    throw new Error("Method not implemented.");
  }
  getAggregatedAttestation(
    attestationDataRoot: import("@chainsafe/ssz").Vector<number>,
    slot: number
  ): Promise<phase0.Attestation> {
    throw new Error("Method not implemented.");
  }
  publishAggregateAndProofs(signedAggregateAndProofs: phase0.SignedAggregateAndProof[]): Promise<void> {
    throw new Error("Method not implemented.");
  }
  prepareBeaconCommitteeSubnet(subscriptions: phase0.BeaconCommitteeSubscription[]): Promise<void> {
    throw new Error("Method not implemented.");
  }

  getAttesterDuties(epoch: number, validatorPubKey: ValidatorIndex[]): Promise<phase0.AttesterDuty[]> {
    throw Error("not implemented");
  }

  getProposerDuties(epoch: number): Promise<phase0.ProposerDuty[]> {
    throw Error("not implemented");
  }

  produceBlock(slot: number, randaoReveal: Buffer, graffiti?: string): Promise<phase0.BeaconBlock> {
    throw Error("not implemented");
  }
}
