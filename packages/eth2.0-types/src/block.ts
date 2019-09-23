/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module types
 */

import {BLSSignature, bytes32, Hash, Slot,} from "./primitive";

import {Eth1Data} from "./misc";

import {Attestation, AttesterSlashing, Deposit, ProposerSlashing, Transfer, VoluntaryExit,} from "./operations";


export interface BeaconBlockBody {
  randaoReveal: BLSSignature;
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
  parentRoot: Hash;
  stateRoot: Hash;
  body: BeaconBlockBody;
  signature: BLSSignature;
}
