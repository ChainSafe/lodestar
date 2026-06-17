import {bench, describe} from "@chainsafe/benchmark";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {
  buildFastConfirmationSnapshot,
  createFastConfirmationCache,
} from "../../../src/forkChoice/fastConfirmation/data.js";
import {runFastConfirmationRules} from "../../../src/forkChoice/fastConfirmation/rules.js";
import {FastConfirmationContext, IFastConfirmationStore} from "../../../src/forkChoice/fastConfirmation/types.js";
import {ForkChoice, PayloadStatus, ProtoBlock} from "../../../src/index.js";
import {Opts, initializeForkChoice} from "./util.js";

describe("forkchoice fast confirmation", () => {
  for (const initialValidatorCount of [100_000, 600_000, 1_000_000]) {
    const initialBlockCount = 3 * SLOTS_PER_EPOCH;
    runFCRRulesBenchmark({initialValidatorCount, initialBlockCount, initialEquivocatedCount: 0});
  }

  for (const initialBlockCount of [10 * SLOTS_PER_EPOCH, (4 * 60 * 60) / 12]) {
    runFCRRulesBenchmark({initialValidatorCount: 600_000, initialBlockCount, initialEquivocatedCount: 0});
  }

  for (const initialEquivocatedCount of [1_000, 10_000, 300_000]) {
    runFCRRulesBenchmark({
      initialValidatorCount: 600_000,
      initialBlockCount: 3 * SLOTS_PER_EPOCH,
      initialEquivocatedCount,
    });
  }
});

/**
 * Benchmark runFastConfirmationRules directly, isolating the FCR cost
 * from updateHead() and proto array weight application.
 */
function runFCRRulesBenchmark(opts: Opts): void {
  bench({
    id: `runFastConfirmationRules vc:${opts.initialValidatorCount} bc:${opts.initialBlockCount} eq:${opts.initialEquivocatedCount}`,
    before: () => {
      const forkChoice = initializeForkChoice({...opts, fastConfirmation: true});

      const head = forkChoice.updateHead();

      // Vote everyone for head so the FCR vote-map paths see a populated voteNextIndices.
      everyoneVotes(head, forkChoice);

      // Advance to second slot of epoch 2 (not epoch boundary)
      const currentSlot = (opts.initialBlockCount + 1) as Slot;
      forkChoice.updateTime(currentSlot);

      // Set previousSlotHead/currentSlotHead for loop conditions
      forkChoice["fcStore"].previousSlotHead = head.blockRoot;
      forkChoice["fcStore"].currentSlotHead = head.blockRoot;

      // Extract private FCR context and store for direct calls
      const ctx = forkChoice["fastConfirmationContext"] as FastConfirmationContext;
      const store = forkChoice["fcStore"] as unknown as IFastConfirmationStore;
      if (!ctx) throw Error("fastConfirmationContext not initialized");

      return {ctx, store};
    },
    // Pass-through: the bench harness invokes fn(beforeEach(inputAll)), so without a
    // beforeEach fn would receive undefined. store is not mutated by the rule runner so
    // no per-iteration reset is required.
    beforeEach: (data) => data,
    fn: ({ctx, store}) => {
      // Measure ONLY the FCR rules — build cache + snapshot + run rules.
      // store is not mutated by runFastConfirmationRules (only the rule runner's caller
      // would assign store.confirmedRoot), so each iteration replays the same work and
      // no beforeEach reset is needed.
      const cache = createFastConfirmationCache();
      const snapshot = buildFastConfirmationSnapshot(ctx, store, cache);
      runFastConfirmationRules(snapshot, ctx, store, cache);
    },
  });
}

function everyoneVotes(vote: ProtoBlock, forkChoice: ForkChoice): void {
  for (let i = 0; i < forkChoice["balances"].length; i++) {
    forkChoice["addLatestMessage"](i, vote.slot, vote.blockRoot, PayloadStatus.FULL);
  }
}
