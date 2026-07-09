import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterAll, beforeAll, bench, describe} from "@chainsafe/benchmark";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {BeaconStateView, CachedBeaconStateElectra, computeTimeAtSlot} from "@lodestar/state-transition";
import {generatePerfTestCachedStateElectra} from "@lodestar/state-transition/test-utils";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {defaultOptions as defaultValidatorOptions} from "@lodestar/validator";
import {BeaconChain} from "../../../../src/chain/index.js";
import {BlockType, produceBlockBody} from "../../../../src/chain/produceBlock/produceBlockBody.js";
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
      const head = chain.beaconEngine.forkChoice.getHead();
      const proposerIndex = state.epochCtx.getBeaconProposer(state.slot);
      const proposerPubKey = state.epochCtx.pubkeyCache.getOrThrow(proposerIndex).toBytes();

      return {chain, state: new BeaconStateView(state), head, proposerIndex, proposerPubKey};
    },
    fn: async ({chain, state, head, proposerIndex, proposerPubKey}) => {
      const slot = state.slot;

      const commonBlockBodyPromise = chain.beaconEngine.produceCommonBlockBody({
        slot: slot + 1,
        graffiti: Buffer.alloc(32),
        randaoReveal: Buffer.alloc(96),
        parentBlock: head,
      });

      // Scalars normally precomputed by produceBlockBase; mirror the genesis exec hash so the EL mock
      // (headBlockHash/finalizedBlockHash ∈ validBlocks) accepts the forkchoice update.
      const parentBlockHash = state.latestExecutionPayloadHeader.blockHash;
      const parentHashHex = toRootHex(parentBlockHash);
      await produceBlockBody.call(chain, BlockType.Full, {
        slot: slot + 1,
        graffiti: Buffer.alloc(32),
        randaoReveal: Buffer.alloc(96),
        parentBlock: head,
        proposerIndex,
        proposerPubKey,
        defaultFeeRecipient: "0x0000000000000000000000000000000000000000",
        feeRecipientCached: false,
        commonBlockBodyPromise,
        safeBlockHash: parentHashHex,
        finalizedBlockHash: parentHashHex,
        timestamp: computeTimeAtSlot(chain.config, slot + 1, state.genesisTime),
        prevRandao: state.getRandaoMix(state.epoch),
        parentBlockHash,
        parentGasLimit: state.latestExecutionPayloadHeader.gasLimit,
        isBuildingOnFull: false,
        parentExecutionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
        payloadAttestations: [],
        withdrawals: state.getExpectedWithdrawals().expectedWithdrawals,
      });
    },
  });
});
