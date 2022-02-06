import {altair, bellatrix} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {fork} from "../allForks/fork";

fork<altair.BeaconState, bellatrix.BeaconState>(ForkName.altair, ForkName.bellatrix);
