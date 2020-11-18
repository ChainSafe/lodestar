import {Attestation, BeaconState} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessAttestationTestCase extends IBaseSpecTest {
  attestation: Attestation;
  pre: BeaconState;
  post?: BeaconState;
}
