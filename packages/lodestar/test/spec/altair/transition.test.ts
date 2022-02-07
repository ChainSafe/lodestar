import {ForkName} from "@chainsafe/lodestar-params";
import {transition} from "../allForks/transition";

// eslint-disable-next-line @typescript-eslint/naming-convention
transition((forkEpoch) => ({ALTAIR_FORK_EPOCH: forkEpoch}), ForkName.phase0, ForkName.altair);
