import {ForkName} from "@chainsafe/lodestar-params";
import {fork} from "../allForks/fork";

fork({}, ForkName.phase0, ForkName.altair);
