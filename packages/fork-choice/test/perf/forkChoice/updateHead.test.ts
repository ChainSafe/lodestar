import {itBench} from "@dapplion/benchmark";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ForkChoice, ProtoBlock} from "../../../src/index.js";
import {initializeForkChoice} from "./util.js";

describe("forkchoice updateHead", () => {
  for (const initialValidatorCount of [100_000, 600_000, 1_000_000]) {
    const forkChoice = initializeForkChoice({initialBlockCount: 2 * 32, initialValidatorCount});

    const vote1 = forkChoice.updateHead();
    const vote2 = forkChoice.getBlockHex(vote1.parentRoot);
    if (!vote2) throw Error("no vote2");
    if (vote1.blockRoot === vote2.blockRoot) throw Error("blockRoot vote1 == vote2");
    if (vote1.slot === vote2.slot) throw Error("slot vote1 == vote2");

    let currentVoteIs1 = true;

    itBench({
      id: `forkChoice updateHead ${initialValidatorCount}`,
      beforeEach: () => {
        // Flip all votes every run
        everyoneVotes(currentVoteIs1 ? vote2 : vote1, forkChoice);
        currentVoteIs1 = !currentVoteIs1;
      },
      fn: () => {
        forkChoice.updateHead();
      },
    });
  }
});

function everyoneVotes(vote: ProtoBlock, forkChoice: ForkChoice): void {
  const nextEpoch = computeEpochAtSlot(vote.slot);
  const nextRoot = vote.blockRoot;
  for (let i = 0; i < forkChoice["balances"].length; i++) {
    forkChoice["addLatestMessage"](i, nextEpoch, nextRoot);
  }
}
