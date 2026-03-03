import {bench, describe} from "@chainsafe/benchmark";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {
  buildFastConfirmationSnapshot,
  createFastConfirmationCache,
} from "../../../src/forkChoice/fastConfirmation/data.js";
import {runFastConfirmationRules} from "../../../src/forkChoice/fastConfirmation/rules.js";
import {FastConfirmationContext, IFastConfirmationStore} from "../../../src/forkChoice/fastConfirmation/types.js";
import {ForkChoice, ProtoBlock} from "../../../src/index.js";
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
      const prevBlock = forkChoice.getBlockHex(head.parentRoot);
      if (!prevBlock) throw Error("no prevBlock");

      // Vote everyone for head
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

      return {forkChoice, ctx, store, head, prevBlock, currentVoteIs1: true, currentSlot};
    },
    beforeEach: (data) => {
      // Flip votes to force fresh vote map computation each iteration
      const target = data.currentVoteIs1 ? data.prevBlock : data.head;
      everyoneVotes(target, data.forkChoice);
      data.currentVoteIs1 = !data.currentVoteIs1;
      data.currentSlot = (data.currentSlot + 1) as Slot;

      // Advance the slot (this calls updateHead + processAttestationQueue but NOT the FCR)
      // We need to advance the slot so getCurrentSlot() returns the right value
      data.forkChoice["fcStore"].currentSlot = data.currentSlot;
      // Apply votes to proto array so getHead/isDescendant work correctly
      data.forkChoice.updateHead();

      return data;
    },
    fn: ({ctx, store}) => {
      // Measure ONLY the FCR rules — build cache + snapshot + run rules
      const cache = createFastConfirmationCache();
      const snapshot = buildFastConfirmationSnapshot(ctx, store, cache);
      runFastConfirmationRules(snapshot, ctx, store, cache);
    },
  });
}

function everyoneVotes(vote: ProtoBlock, forkChoice: ForkChoice): void {
  const nextEpoch = computeEpochAtSlot(vote.slot);
  const nextRoot = vote.blockRoot;
  for (let i = 0; i < forkChoice["balances"].length; i++) {
    forkChoice["addLatestMessage"](i, nextEpoch, nextRoot);
  }
}
