import {altair, phase0} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../type";

export interface IProcessAttestationTestCase extends IBaseSpecTest {
  attestation: phase0.Attestation;
  pre: altair.BeaconState;
  post?: altair.BeaconState;
}
