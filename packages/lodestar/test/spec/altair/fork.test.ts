import {phase0, altair} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {fork} from "../allForks/fork";

fork<phase0.BeaconState, altair.BeaconState>(ForkName.phase0, ForkName.altair);
