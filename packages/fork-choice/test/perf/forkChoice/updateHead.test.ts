import {itBench} from "@dapplion/benchmark";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ForkChoice, ProtoBlock} from "../../../src/index.js";
import {initializeForkChoice, Opts} from "./util.js";

describe("forkchoice updateHead", () => {
  for (const initialValidatorCount of [100_000, 600_000, 1_000_000]) {
    runUpdateHeadBenchmark({initialValidatorCount, initialBlockCount: 64, initialEquivocatedCount: 0});
  }

  for (const initialBlockCount of [
    // 10 epochs of blocks ~ 1 hour
    10 * 32,
    // 4 hours of blocks
    (4 * 60 * 60) / 12,
    // 1 day of blocks
    (24 * 60 * 60) / 12,
    // // 20 days of blocks
    // (20 * 24 * 60 * 60) / 12,
  ]) {
    runUpdateHeadBenchmark({initialValidatorCount: 600_000, initialBlockCount, initialEquivocatedCount: 0});
  }

  for (const initialEquivocatedCount of [1_000, 10_000, 300_000]) {
    runUpdateHeadBenchmark({initialValidatorCount: 600_000, initialBlockCount: 64, initialEquivocatedCount});
  }

  function runUpdateHeadBenchmark(opts: Opts): void {
    itBench({
      id: `forkChoice updateHead vc ${opts.initialValidatorCount} bc ${opts.initialBlockCount} eq ${opts.initialEquivocatedCount}`,
      before: () => {
        const forkChoice = initializeForkChoice(opts);

        const vote1 = forkChoice.updateHead();
        const vote2 = forkChoice.getBlockHex(vote1.parentRoot);
        if (!vote2) throw Error("no vote2");
        if (vote1.blockRoot === vote2.blockRoot) throw Error("blockRoot vote1 == vote2");
        if (vote1.slot === vote2.slot) throw Error("slot vote1 == vote2");

        return {
          forkChoice,
          vote1,
          vote2,
          currentVoteIs1: true,
        };
      },
      beforeEach: (data) => {
        // Flip all votes every run
        everyoneVotes(data.currentVoteIs1 ? data.vote2 : data.vote1, data.forkChoice);
        data.currentVoteIs1 = !data.currentVoteIs1;
        return data;
      },
      fn: ({forkChoice}) => {
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
