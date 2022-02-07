import {ForkName} from "@chainsafe/lodestar-params";
import {fork} from "../allForks/fork";

// eslint-disable-next-line @typescript-eslint/naming-convention
fork({ALTAIR_FORK_EPOCH: 0}, ForkName.altair, ForkName.bellatrix);
