import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {
  beforeValue,
  getNetworkCachedState,
  getNetworkCachedBlock,
} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {config} from "@chainsafe/lodestar-config/default";
import {SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {BeaconChain} from "../../../src/chain";
import {ExecutionEngineDisabled} from "../../../src/executionEngine";
import {Eth1ForBlockProductionDisabled} from "../../../src/eth1";
import {testLogger} from "../../utils/logger";
import {linspace} from "../../../src/util/numpy";
import {BeaconDb} from "../../../src";
import {LevelDbController} from "@chainsafe/lodestar-db";

const network = "mainnet";
// Must start at the first slot of the epoch to have a proper checkpoint state.
// Using `computeStartSlotAtEpoch(...) - 1` will cause the chain to initialize with a state that's not the checkpoint
// state, so processing the first block of the epoch will cause error `BLOCK_ERROR_WOULD_REVERT_FINALIZED_SLOT`
const startSlot = computeStartSlotAtEpoch(117713);
const slotCount = 1 * SLOTS_PER_EPOCH;
const endSlot = startSlot + slotCount;
const missedSlots = new Set<number>([]);

const logger = testLogger();

describe("verify+import blocks - range sync perf test", () => {
  setBenchOpts({
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
  });

  const blocks = beforeValue(
    async () =>
      Promise.all(
        // Start at next slot, since the parent of current state's header is not known
        linspace(startSlot + 1, endSlot)
          .filter((slot) => !missedSlots.has(slot))
          .map(async (slot) =>
            getNetworkCachedBlock(network, slot, 300_000).catch((e) => {
              (e as Error).message = `slot ${slot} - ${(e as Error).message}`;
              throw e;
            })
          )
      ),
    300_000
  );

  const stateOg = beforeValue(async () => {
    const state = await getNetworkCachedState(network, startSlot, 300_000);
    state.hashTreeRoot();
    return state;
  }, 300_000);

  let db: BeaconDb;
  before(async () => {
    db = new BeaconDb({config, controller: new LevelDbController({name: ".tmpdb"}, {logger})});
    await db.start();
  });
  after(async () => {
    // If before blocks fail, db won't be declared
    if (db !== undefined) await db.stop();
  });

  itBench({
    id: `altair verifyImport ${network}_s${startSlot}:${slotCount}`,
    minRuns: 5,
    maxRuns: Infinity,
    maxMs: Infinity,
    timeoutBench: 10 * 60 * 1000,
    beforeEach: () => {
      const state = stateOg.value.clone();
      const chain = new BeaconChain(
        {
          proposerBoostEnabled: true,
          safeSlotsToImportOptimistically: SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY,
          disableArchiveOnCheckpoint: true,
        },
        {
          config: state.config,
          db,
          logger,
          metrics: null,
          anchorState: state,
          eth1: new Eth1ForBlockProductionDisabled(),
          executionEngine: new ExecutionEngineDisabled(),
        }
      );

      return chain;
    },
    fn: async (chain) => {
      await chain.processChainSegment(blocks.value, {
        // Only skip importing attestations for finalized sync. For head sync attestation are valuable.
        // Importing attestations also triggers a head update, see https://github.com/ChainSafe/lodestar/issues/3804
        // TODO: Review if this is okay, can we prevent some attacks by importing attestations?
        skipImportingAttestations: true,
        // Ignores ALREADY_KNOWN or GENESIS_BLOCK errors, and continues with the next block in chain segment
        ignoreIfKnown: true,
        // Ignore WOULD_REVERT_FINALIZED_SLOT error, continue with the next block in chain segment
        ignoreIfFinalized: true,
        // We won't attest to this block so it's okay to ignore a SYNCING message from execution layer
        fromRangeSync: true,
        // when this runs, syncing is the most important thing and gossip is not likely to run
        // so we can utilize worker threads to verify signatures
        blsVerifyOnMainThread: false,
      });
      chain.close();
    },
  });
});
