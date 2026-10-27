import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {routes} from "@lodestar/api";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName, ForkSeq} from "@lodestar/params";
import {
  BeaconStateView,
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  createCachedBeaconState,
  executionPayloadToPayloadHeader,
} from "@lodestar/state-transition";
import {BlindedBeaconBlock, ProducedBlockSource, electra} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getValidatorApi} from "../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../src/api/options.js";
import {ArchiveMode} from "../../../src/chain/archiveStore/interface.js";
import {BeaconEngineMode} from "../../../src/chain/beaconEngine/options.js";
import {BeaconChain} from "../../../src/chain/chain.js";
import {BlockType} from "../../../src/chain/produceBlock/index.js";
import {BeaconDb} from "../../../src/db/index.js";
import {BuilderStatus} from "../../../src/execution/builder/http.js";
import * as executionBuilder from "../../../src/execution/builder/index.js";
import {IExecutionBuilder} from "../../../src/execution/builder/interface.js";
import {getExecutionEngineFromBackend} from "../../../src/execution/engine/index.js";
import {ExecutionEngineMockBackend} from "../../../src/execution/engine/mock.js";
import {initDevState} from "../../../src/node/utils/state.js";
import {SyncState} from "../../../src/sync/interface.js";
import {getMockedNetwork} from "../../mocks/mockedNetwork.js";
import {createBeaconChain} from "../../utils/chain.js";

describe("engine block production", () => {
  afterEach(() => vi.restoreAllMocks());

  for (const fork of [ForkName.electra, ForkName.fulu]) {
    it(`produces a ${fork} block with a valid state root and facade DA cache`, async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "beacon-production-"));
      const logger = testLogger();
      const config = createChainForkConfig({
        ...defaultConfig,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: fork === ForkName.fulu ? 0 : Infinity,
        GLOAS_FORK_EPOCH: Infinity,
      });
      const genesis = initDevState(config, 8, {genesisTime: 1644000000});
      const beaconConfig = createBeaconConfig(config, genesis.genesisValidatorsRoot);

      const state = new BeaconStateView(createCachedBeaconState(genesis, {config: beaconConfig, pubkeyCache}));
      const controller = new AbortController();
      const executionEngine = getExecutionEngineFromBackend(
        new ExecutionEngineMockBackend({
          genesisBlockHash: toRootHex(state.latestExecutionPayloadHeader.blockHash),
          genesisTime: state.genesisTime,
          config,
        }),
        {signal: controller.signal, logger}
      );
      const db = new BeaconDb(config, await LevelDbController.create({name: path.join(directory, "db")}, {logger}), {
        dataColumnDir: path.join(directory, "data_columns"),
        logger,
      });
      const builder: IExecutionBuilder = {
        status: BuilderStatus.enabled,
        faultInspectionWindow: 8,
        allowedFaults: 8,
        updateStatus: vi.fn(),
        checkStatus: vi.fn(),
        registerValidator: vi.fn(),
        getValidatorRegistration: vi.fn(),
        getHeader: vi.fn<IExecutionBuilder["getHeader"]>(),
        submitBlindedBlock: vi.fn(),
        submitBlindedBlockNoResponse: vi.fn(),
      };
      vi.spyOn(executionBuilder, "initializeExecutionBuilder").mockReturnValueOnce(builder);
      let chain: BeaconChain | undefined;
      try {
        chain = await createBeaconChain(
          {
            beaconEngineMode: BeaconEngineMode.MainThread,
            blsVerifyAllMainThread: true,
            disableArchiveOnCheckpoint: true,
            suggestedFeeRecipient: "0x0000000000000000000000000000000000000001",
            skipCreateStateCacheIfAvailable: true,
            archiveStateEpochFrequency: 1024,
            minSameMessageSignatureSetsToBatch: 32,
            archiveMode: ArchiveMode.Frequency,
          },
          {
            privateKey: await generateKeyPair("secp256k1"),
            config: beaconConfig,
            pubkeyCache,
            db,
            dataDir: directory,
            dbName: directory,
            logger,
            processShutdownCallback: () => {},
            metrics: null,
            validatorMonitorOpts: null,
            anchorStateBytes: state.serialize(),
            isAnchorStateFinalized: true,
            executionEngine,
            executionBuilderOpts: {...executionBuilder.defaultExecutionBuilderOpts, enabled: true},
          }
        );
        const attrs = {slot: 1, randaoReveal: Buffer.alloc(96), graffiti: Buffer.alloc(32)};
        const api = getValidatorApi(
          {...defaultApiOptions, private: true},
          {
            chain,
            config: beaconConfig,
            db,
            logger,
            metrics: null,
            network: getMockedNetwork(),
            sync: {
              state: SyncState.Synced,
              close: vi.fn(),
              getSyncStatus: vi.fn(),
              isSynced: vi.fn().mockReturnValue(true),
              isSyncing: vi.fn().mockReturnValue(false),
              getSyncChainsDebugState: vi.fn().mockReturnValue([]),
            },
          }
        );
        const full = await api.produceBlockV3({
          ...attrs,
          graffiti: "",
          builderSelection: routes.validator.BuilderSelection.ExecutionOnly,
        });
        const block = (full.data as {block: electra.BeaconBlock}).block;
        const expected = state.processSlots(1).stateTransition(
          {block: {message: block, signature: Buffer.alloc(96)}},
          {
            verifyProposer: false,
            verifySignatures: false,
            verifyStateRoot: true,
            executionPayloadStatus: ExecutionPayloadStatus.valid,
            dataAvailabilityStatus: DataAvailabilityStatus.Available,
          },
          {metrics: null}
        );
        expect(block.stateRoot).toEqual(expected.hashTreeRoot());
        const root = toRootHex(beaconConfig.getForkTypes(1).BeaconBlock.hashTreeRoot(block));
        const produced = chain.blockProductionCache.get(root);
        expect(produced, `missing ${fork} production cache entry`).toBeDefined();
        expect(produced?.type).toBe(BlockType.Full);
        expect(chain.blockProductionCache.size).toBe(1);
        const body = (block as electra.BeaconBlock).body;
        const header = executionPayloadToPayloadHeader(ForkSeq[fork], body.executionPayload);
        vi.mocked(builder.getHeader).mockResolvedValue({
          header,
          executionPayloadValue: 1n,
          blobKzgCommitments: body.blobKzgCommitments,
          executionRequests: body.executionRequests,
        });
        const {data: blinded} = await api.produceBlockV3({
          ...attrs,
          graffiti: "",
          builderSelection: routes.validator.BuilderSelection.BuilderOnly,
        });
        expect((blinded as BlindedBeaconBlock).stateRoot).toEqual(block.stateRoot);
        expect(chain.blockProductionCache.get(root)?.type).toBe(BlockType.Blinded);
        expect(chain.blockProductionCache.size).toBe(1);
        vi.mocked(builder.getHeader).mockRejectedValue(new Error("builder unavailable"));
        const fallback = await chain.beaconEngine.produceBlock({
          ...attrs,
          builderSelection: routes.validator.BuilderSelection.BuilderOnly,
          builderBoostFactor: 100n,
        });
        // Upstream normalizes BuilderOnly to BuilderAlways, retaining local production as fallback.
        expect(fallback).toMatchObject({
          ok: true,
          data: {executionPayloadBlinded: false, executionPayloadSource: ProducedBlockSource.engine},
        });
        expect(chain.blockProductionCache.size).toBe(1);
      } finally {
        controller.abort();
        await chain?.close();
        await db.close();
        await rm(directory, {recursive: true, force: true});
      }
    }, 30000);
  }
});
