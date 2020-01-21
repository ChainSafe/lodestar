/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module types
 */

import {ArrayLike} from "@chainsafe/ssz";

import {BLSSignature, Bytes32, Root, Slot} from "./primitive";
import {Eth1Data} from "./misc";
import {Attestation, AttesterSlashing, Deposit, ProposerSlashing, VoluntaryExit} from "./operations";


export interface BeaconBlockBody {
  randaoReveal: BLSSignature;
  eth1Data: Eth1Data;
  graffiti: Bytes32;
  proposerSlashings: ArrayLike<ProposerSlashing>;
  attesterSlashings: ArrayLike<AttesterSlashing>;
  attestations: ArrayLike<Attestation>;
  deposits: ArrayLike<Deposit>;
  voluntaryExits: ArrayLike<VoluntaryExit>;
}

export interface BeaconBlock {
  // Header
  slot: Slot;
  parentRoot: Root;
  stateRoot: Root;
  body: BeaconBlockBody;
  signature: BLSSignature;
}
