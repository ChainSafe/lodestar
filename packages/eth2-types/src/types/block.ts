/**
 * @module types
 */

import {
  bytes32,
  bytes96,
  Slot,
  BLSSignature,
} from "./primitive";

import {Eth1Data} from "./misc";

import {
  Attestation,
  AttesterSlashing,
  Deposit,
  ProposerSlashing,
  Transfer,
  VoluntaryExit,
} from "./operations";


export interface BeaconBlockBody {
  randaoReveal: bytes96;
  eth1Data: Eth1Data;
  graffiti: bytes32;
  proposerSlashings: ProposerSlashing[];
  attesterSlashings: AttesterSlashing[];
  attestations: Attestation[];
  deposits: Deposit[];
  voluntaryExits: VoluntaryExit[];
  transfers: Transfer[];
}

export interface BeaconBlock {
  // Header
  slot: Slot;
  parentRoot: bytes32;
  stateRoot: bytes32;
  body: BeaconBlockBody;
  signature: BLSSignature;
}
