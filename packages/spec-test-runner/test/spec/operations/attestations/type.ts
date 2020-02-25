import {Attestation, BeaconState,number64} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";


export interface IProcessAttestationTestCase extends IBaseSpecTest {

  attestation: Attestation;
  pre: BeaconState;
  post?: BeaconState;
}