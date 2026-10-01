import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {describe, expect, it, vi} from "vitest";
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
  createPubkeyCache,
  executionPayloadToPayloadHeader,
} from "@lodestar/state-transition";
import {electra} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ArchiveMode} from "../../../src/chain/archiveStore/interface.js";
import {BeaconEngineErrorCode} from "../../../src/chain/beaconEngine/interface.js";
import {BeaconChain} from "../../../src/chain/chain.js";
import {BlockType} from "../../../src/chain/produceBlock/index.js";
import {BeaconDb} from "../../../src/db/index.js";
import {BuilderStatus} from "../../../src/execution/builder/http.js";
import {IExecutionBuilder} from "../../../src/execution/builder/interface.js";
import {getExecutionEngineFromBackend} from "../../../src/execution/engine/index.js";
import {ExecutionEngineMockBackend} from "../../../src/execution/engine/mock.js";
import {initDevState} from "../../../src/node/utils/state.js";

describe("engine block production", () => {
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
      const pubkeyCache = createPubkeyCache();
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
      const db = new BeaconDb(config, await LevelDbController.create({name: path.join(directory, "db")}, {logger}));
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
      let chain: BeaconChain | undefined;
      try {
        chain = new BeaconChain(
          {
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
            validatorMonitor: null,
            anchorState: state,
            isAnchorStateFinalized: true,
            executionEngine,
            executionBuilder: builder,
          }
        );
        const attrs = {slot: 1, randaoReveal: Buffer.alloc(96), graffiti: Buffer.alloc(32)};
        // TODO (zig_engine_el_plan.md Step 5): exercise the final V3/V4 entries; remove transitional preparation/delegate calls.
        const {parentBlock, commonBlockBodyPromise} = await chain.beaconEngine.prepareBlockProduction(attrs);
        const {block} = await chain.produceBlock({...attrs, parentBlock, commonBlockBodyPromise});
        const expected = state.processSlots(1).stateTransition(
          {message: block, signature: Buffer.alloc(96)},
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
        const {block: blinded} = await chain.produceBlindedBlock({...attrs, parentBlock, commonBlockBodyPromise});
        expect(blinded.stateRoot).toEqual(block.stateRoot);
        expect(chain.blockProductionCache.get(root)?.type).toBe(BlockType.Blinded);
        expect(chain.blockProductionCache.size).toBe(1);
        vi.mocked(builder.getHeader).mockRejectedValue(new Error("builder unavailable"));
        const failed = await chain.beaconEngine.produceBlockForProposal(BlockType.Blinded, {
          ...attrs,
          parentBlock,
          commonBlockBodyPromise,
        });
        expect(failed).toEqual({
          ok: false,
          code: BeaconEngineErrorCode.INTERNAL,
          payload: {message: "builder unavailable"},
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
