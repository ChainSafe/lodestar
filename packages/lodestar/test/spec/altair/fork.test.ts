import {ForkName} from "@chainsafe/lodestar-params";
import {fork} from "../allForks/fork.js";

fork({}, ForkName.phase0, ForkName.altair);
