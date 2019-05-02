import {Attestation, AttestationData, BeaconBlock, bytes32, Deposit, Shard, Slot, Eth1Data} from "../../types";

import {getEmptyBlock} from "../../chain/genesis";

import {IBeaconApi} from "./interfaces";

export interface MockAPIOpts {
  head?: BeaconBlock;
  pendingAttestations?: Attestation[];
  getPendingDeposits?: Deposit[];
  Eth1Data?: Eth1Data;
  attestationData?: AttestationData;
}

export class MockAPI implements IBeaconApi {
  private head;
  private attestations;
  public constructor(opts?: MockAPIOpts) {
    this.attestations = opts && opts.pendingAttestations || [];
    this.head = opts && opts.head || getEmptyBlock();
  }
  public async getChainHead(): Promise<BeaconBlock> {
    return this.head;
  }

  public async getPendingAttestations(): Promise<Attestation[]> {
    return this.attestations;
  }

  public async getPendingDeposits(): Promise<Deposit[]> {
    return [];
  }

  public async getEth1Data(): Promise<Eth1Data> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as Eth1Data;
  }

  public async computeStateRoot(block: BeaconBlock): Promise<bytes32> {
    return Buffer.alloc(32);
  }

  public async getAttestationData(slot: Slot, shard: Shard): Promise<AttestationData> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as AttestationData;
  }

  public async putAttestation(attestation: Attestation): Promise<void> {
    this.attestations.push(attestation);
  }

  public async putBlock(block: BeaconBlock): Promise<void> {
    this.head = block;
  }
}
