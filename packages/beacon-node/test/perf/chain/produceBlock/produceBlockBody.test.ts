import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterAll, beforeAll, bench, describe} from "@chainsafe/benchmark";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {BeaconStateView, CachedBeaconStateElectra} from "@lodestar/state-transition";
import {generatePerfTestCachedStateElectra} from "@lodestar/state-transition/test-utils";
import {toRootHex} from "@lodestar/utils";
import {defaultOptions as defaultValidatorOptions} from "@lodestar/validator";
import {BeaconChain} from "../../../../src/chain/index.js";
import {
  BlockType,
  produceBlockBody,
  produceCommonBlockBody,
} from "../../../../src/chain/produceBlock/produceBlockBody.js";
import {getExecutionEngineFromBackend} from "../../../../src/execution/engine/index.js";
import {ExecutionEngineMockBackend} from "../../../../src/execution/engine/mock.js";
import {ArchiveMode, BeaconDb} from "../../../../src/index.js";

const logger = testLogger();

describe("produceBlockBody", () => {
  const stateOg = generatePerfTestCachedStateElectra({goBackOneSlot: false});

  let db: BeaconDb;
  let chain: BeaconChain;
  let state: CachedBeaconStateElectra;

  const controller = new AbortController();

  beforeAll(async () => {
    state = stateOg.clone();

    const executionEngineBackend = new ExecutionEngineMockBackend({
      genesisBlockHash: toRootHex(state.latestExecutionPayloadHeader.blockHash),
      genesisTime: state.genesisTime,
      config: state.config,
    });
    const executionEngine = getExecutionEngineFromBackend(executionEngineBackend, {
      signal: controller.signal,
      logger: testLogger("executionEngine"),
    });

    db = new BeaconDb(state.config, await LevelDbController.create({name: ".tmpdb"}, {logger}));
    chain = new BeaconChain(
      {
        proposerBoost: true,
        proposerBoostReorg: true,
        computeUnrealized: false,
        disableArchiveOnCheckpoint: true,
        suggestedFeeRecipient: defaultValidatorOptions.suggestedFeeRecipient,
        skipCreateStateCacheIfAvailable: true,
        archiveStateEpochFrequency: 1024,
        minSameMessageSignatureSetsToBatch: 32,
        archiveMode: ArchiveMode.Frequency,
      },
      {
        privateKey: await generateKeyPair("secp256k1"),
        config: state.config,
        pubkeyCache: state.epochCtx.pubkeyCache,
        db,
        dataDir: ".",
        dbName: ".",
        logger,
        processShutdownCallback: () => {},
        metrics: null,
        validatorMonitor: null,
        anchorState: new BeaconStateView(state),
        isAnchorStateFinalized: true,
        executionEngine,
      }
    );
  });

  afterAll(async () => {
    controller.abort();
    // If before blocks fail, db won't be declared
    if (db !== undefined) await db.close();
    if (chain !== undefined) await chain.close();
  });

  bench({
    id: "proposeBlockBody type=full, size=empty",
    minRuns: 5,
    maxMs: Infinity,
    timeoutBench: 60 * 1000,
    beforeEach: async () => {
      const head = chain.forkChoice.getHead();
      const proposerIndex = state.epochCtx.getBeaconProposer(state.slot);
      const proposerPubKey = state.epochCtx.pubkeyCache.getOrThrow(proposerIndex).toBytes();

      return {chain, state: new BeaconStateView(state), head, proposerIndex, proposerPubKey};
    },
    fn: async ({chain, state, head, proposerIndex, proposerPubKey}) => {
      const slot = state.slot;

      const commonBlockBodyPromise = produceCommonBlockBody.call(chain, BlockType.Full, state, {
        slot: slot + 1,
        graffiti: Buffer.alloc(32),
        randaoReveal: Buffer.alloc(96),
        parentBlock: head,
      });

      await produceBlockBody.call(chain, BlockType.Full, state, {
        slot: slot + 1,
        graffiti: Buffer.alloc(32),
        randaoReveal: Buffer.alloc(96),
        parentBlock: head,
        proposerIndex,
        proposerPubKey,
        commonBlockBodyPromise,
      });
    },
  });
});
