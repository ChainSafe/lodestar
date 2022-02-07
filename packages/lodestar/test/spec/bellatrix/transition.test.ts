import {ForkName} from "@chainsafe/lodestar-params";
import {transition} from "../allForks/transition";

transition(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  (forkEpoch) => ({ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: forkEpoch}),
  ForkName.altair,
  ForkName.bellatrix
);
