import {fromHexString} from "@chainsafe/ssz";
import {itBench} from "@dapplion/benchmark";
import {config} from "@lodestar/config/default";
import {LevelDbController} from "@lodestar/db";
import {SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY} from "@lodestar/params";
import {defaultOptions as defaultValidatorOptions} from "@lodestar/validator";
import {CachedBeaconStateAltair} from "@lodestar/state-transition";
// eslint-disable-next-line import/no-relative-packages
import {generatePerfTestCachedStateAltair} from "../../../../../state-transition/test/perf/util.js";
import {BeaconChain} from "../../../../src/chain/index.js";
import {BlockType, produceBlockBody} from "../../../../src/chain/produceBlock/produceBlockBody.js";
import {Eth1ForBlockProductionDisabled} from "../../../../src/eth1/index.js";
import {ExecutionEngineDisabled} from "../../../../src/execution/engine/index.js";
import {BeaconDb} from "../../../../src/index.js";
import {testLogger} from "../../../utils/logger.js";

const logger = testLogger();

describe("produceBlockBody", () => {
  const stateOg = generatePerfTestCachedStateAltair({goBackOneSlot: false});

  let db: BeaconDb;
  let chain: BeaconChain;
  let state: CachedBeaconStateAltair;

  before(async () => {
    db = new BeaconDb(config, await LevelDbController.create({name: ".tmpdb"}, {logger}));
    state = stateOg.clone();
    chain = new BeaconChain(
      {
        proposerBoost: true,
        proposerBoostReorg: false,
        computeUnrealized: false,
        safeSlotsToImportOptimistically: SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY,
        disableArchiveOnCheckpoint: true,
        suggestedFeeRecipient: defaultValidatorOptions.suggestedFeeRecipient,
        skipCreateStateCacheIfAvailable: true,
        minSameMessageSignatureSetsToBatch: 32,
      },
      {
        config: state.config,
        db,
        logger,
        processShutdownCallback: () => {},
        metrics: null,
        anchorState: state,
        eth1: new Eth1ForBlockProductionDisabled(),
        executionEngine: new ExecutionEngineDisabled(),
      }
    );
  });

  after(async () => {
    // If before blocks fail, db won't be declared
    if (db !== undefined) await db.close();
    if (chain !== undefined) await chain.close();
  });

  itBench({
    id: "proposeBlockBody type=full, size=empty",
    minRuns: 5,
    maxMs: Infinity,
    timeoutBench: 60 * 1000,
    beforeEach: async () => {
      const head = chain.forkChoice.getHead();
      const proposerIndex = state.epochCtx.getBeaconProposer(state.slot);
      const proposerPubKey = state.epochCtx.index2pubkey[proposerIndex].toBytes();

      return {chain, state, head, proposerIndex, proposerPubKey};
    },
    fn: async ({chain, state, head, proposerIndex, proposerPubKey}) => {
      const slot = state.slot;

      await produceBlockBody.call(chain, BlockType.Full, state, {
        parentSlot: slot,
        slot: slot + 1,
        graffiti: Buffer.alloc(32),
        randaoReveal: Buffer.alloc(96),
        parentBlockRoot: fromHexString(head.blockRoot),
        proposerIndex,
        proposerPubKey,
      });
    },
  });
});
