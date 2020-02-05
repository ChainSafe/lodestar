/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module types
 */

import {BLSSignature, bytes32, Root, Slot,} from "./primitive";

import {Eth1Data} from "./misc";

import {Attestation, AttesterSlashing, Deposit, ProposerSlashing, SignedVoluntaryExit,} from "./operations";


export interface BeaconBlockBody {
  randaoReveal: BLSSignature;
  eth1Data: Eth1Data;
  graffiti: bytes32;
  proposerSlashings: ProposerSlashing[];
  attesterSlashings: AttesterSlashing[];
  attestations: Attestation[];
  deposits: Deposit[];
  voluntaryExits: SignedVoluntaryExit[];
}

export interface BeaconBlock {
  // Header
  slot: Slot;
  parentRoot: Root;
  stateRoot: Root;
  body: BeaconBlockBody;
}

export interface SignedBeaconBlock {
  message: BeaconBlock;
  signature: BLSSignature;
}
