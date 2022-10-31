import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {config} from "@lodestar/config/default";
import {SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY, SLOTS_PER_EPOCH} from "@lodestar/params";
import {LevelDbController} from "@lodestar/db";
import {sleep} from "@lodestar/utils";
import {defaultOptions as defaultValidatorOptions} from "@lodestar/validator";
import {
  beforeValue,
  getNetworkCachedState,
  getNetworkCachedBlock,
} from "../../../../state-transition/test/utils/index.js";
import {rangeSyncTest} from "../../../../state-transition/test/perf/params.js";
import {BeaconChain} from "../../../src/chain/index.js";
import {ExecutionEngineDisabled} from "../../../src/execution/engine/index.js";
import {Eth1ForBlockProductionDisabled} from "../../../src/eth1/index.js";
import {testLogger} from "../../utils/logger.js";
import {linspace} from "../../../src/util/numpy.js";
import {BeaconDb} from "../../../src/index.js";

// Define this params in `packages/state-transition/test/perf/params.ts`
// to trigger Github actions CI cache
const {network, startSlot, endSlot} = rangeSyncTest;
const slotCount = endSlot - startSlot;

const timeoutInfura = 300_000;
const logger = testLogger();

describe.skip("verify+import blocks - range sync perf test", () => {
  setBenchOpts({
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
  });

  before("Check correct params", () => {
    // Must start at the first slot of the epoch to have a proper checkpoint state.
    // Using `computeStartSlotAtEpoch(...) - 1` will cause the chain to initialize with a state that's not the checkpoint
    // state, so processing the first block of the epoch will cause error `BLOCK_ERROR_WOULD_REVERT_FINALIZED_SLOT`
    if (rangeSyncTest.startSlot % SLOTS_PER_EPOCH !== 0) {
      throw Error("startSlot must be the first slot in the epoch");
    }
  });

  const blocks = beforeValue(
    async () =>
      Promise.all(
        // Start at next slot, since the parent of current state's header is not known
        linspace(startSlot + 1, endSlot).map(async (slot) =>
          getNetworkCachedBlock(network, slot, timeoutInfura).catch((e: unknown) => {
            (e as Error).message = `slot ${slot} - ${(e as Error).message}`;
            throw e;
          })
        )
      ),
    timeoutInfura
  );

  const stateOg = beforeValue(async () => {
    const state = await getNetworkCachedState(network, startSlot, timeoutInfura);
    state.hashTreeRoot();
    return state;
  }, timeoutInfura);

  let db: BeaconDb;
  before(async () => {
    db = new BeaconDb({config, controller: new LevelDbController({name: ".tmpdb"}, {})});
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
    timeoutBench: 10 * 60 * 1000 + 16_000 * 5,
    beforeEach: async () => {
      const state = stateOg.value.clone();
      const chain = new BeaconChain(
        {
          proposerBoostEnabled: true,
          computeUnrealized: false,
          safeSlotsToImportOptimistically: SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY,
          disableArchiveOnCheckpoint: true,
          suggestedFeeRecipient: defaultValidatorOptions.suggestedFeeRecipient,
          skipCreateStateCacheIfAvailable: true,
        },
        {
          config: state.config,
          db,
          logger,
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          processShutdownCallback: () => {},
          metrics: null,
          anchorState: state,
          eth1: new Eth1ForBlockProductionDisabled(),
          executionEngine: new ExecutionEngineDisabled(),
        }
      );

      // wait for bls worker threads to warm up
      await sleep(16_000);

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
      await chain.close();
    },
  });
});
