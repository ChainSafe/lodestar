import {bench, describe} from "@chainsafe/benchmark";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot} from "@lodestar/types";
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

  // Larger confirmed chain (more blocks) at a fixed validator count. initialBlockCount must be a
  // multiple of SLOTS_PER_EPOCH so currentSlot lands on an epoch boundary and isConfirmedChainSafe() runs.
  runFCRRulesBenchmark({
    initialValidatorCount: 600_000,
    initialBlockCount: 10 * SLOTS_PER_EPOCH,
    initialEquivocatedCount: 0,
  });

  // One equivocation case to keep the equivocation-scoring path covered. Kept at a smaller validator
  // count because the test stub treats every slot's committee as the full validator set, which makes
  // the equivocation path much heavier than mainnet — so this is path coverage, not a realistic figure.
  runFCRRulesBenchmark({
    initialValidatorCount: 100_000,
    initialBlockCount: 3 * SLOTS_PER_EPOCH,
    initialEquivocatedCount: 1_000,
  });
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

      // Measure the epoch-boundary path that walks the previous epoch's confirmed chain.
      // Avoid calling updateTime() here: it would run FCR in setup instead of inside the benchmarked fn.
      const currentSlot = opts.initialBlockCount as Slot;
      const confirmedRoot = rootFromSlot(computeStartSlotAtEpoch((computeEpochAtSlot(currentSlot) - 1) as Epoch));
      forkChoice["fcStore"].currentSlot = currentSlot;
      forkChoice["fcStore"].confirmedRoot = confirmedRoot;

      // Set previousSlotHead/currentSlotHead for loop conditions
      forkChoice["fcStore"].previousSlotHead = head.blockRoot;
      forkChoice["fcStore"].currentSlotHead = head.blockRoot;

      const confirmedBlock = forkChoice["getBlockHexDefaultStatus"](confirmedRoot);
      if (!confirmedBlock || computeEpochAtSlot(confirmedBlock.slot) + 1 !== computeEpochAtSlot(currentSlot)) {
        throw Error("fast confirmation benchmark must start at an epoch boundary with a previous-epoch confirmed root");
      }

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

function rootFromSlot(slot: Slot): RootHex {
  return `0x${String(slot).padStart(64, "0")}`;
}

function everyoneVotes(vote: ProtoBlock, forkChoice: ForkChoice): void {
  const nextRoot = vote.blockRoot;
  for (let i = 0; i < forkChoice["balances"].length; i++) {
    // addLatestMessage's second arg is `nextSlot: Slot`, not an epoch — pass vote.slot directly so
    // the internal computeEpochAtSlot(nextSlot) lands on the correct vote epoch instead of
    // computeEpochAtSlot(epoch)=0 making every vote look 3 epochs stale.
    forkChoice["addLatestMessage"](i, vote.slot, nextRoot, PayloadStatus.FULL);
  }
}
