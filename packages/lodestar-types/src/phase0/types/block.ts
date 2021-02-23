/**
 * @module types
 */

import {List} from "@chainsafe/ssz";

import {BLSSignature, Bytes32, Root, Slot, ValidatorIndex} from "../../primitive/types";
import {Eth1Data} from "./misc";
import {Attestation, AttesterSlashing, Deposit, ProposerSlashing, SignedVoluntaryExit} from "./operations";

export interface BeaconBlockBody {
  randaoReveal: BLSSignature;
  eth1Data: Eth1Data;
  graffiti: Bytes32;
  proposerSlashings: List<ProposerSlashing>;
  attesterSlashings: List<AttesterSlashing>;
  attestations: List<Attestation>;
  deposits: List<Deposit>;
  voluntaryExits: List<SignedVoluntaryExit>;
}

export interface BeaconBlock {
  // Header
  slot: Slot;
  proposerIndex: ValidatorIndex;
  parentRoot: Root;
  stateRoot: Root;
  body: BeaconBlockBody;
}

export interface SignedBeaconBlock {
  message: BeaconBlock;
  signature: BLSSignature;
}
