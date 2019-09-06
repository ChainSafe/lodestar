import {Attestation, BeaconState} from "@chainsafe/eth2.0-types";

export interface ProcessAttestationTestCase {

  attestation: Attestation;
  pre: BeaconState;
  post?: BeaconState;

}