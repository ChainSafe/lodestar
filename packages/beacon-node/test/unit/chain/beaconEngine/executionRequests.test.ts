import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {ExecutionStatus, PayloadStatus} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {
  BeaconStateView,
  DataAvailabilityStatus,
  createCachedBeaconState,
  createPubkeyCache,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {importExecutionPayload} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {
  PayloadEnvelopeInput,
  PayloadEnvelopeInputSource,
} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {BlockType, produceBlockBody} from "../../../../src/chain/produceBlock/index.js";
import {BeaconDb} from "../../../../src/db/beacon.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/engine/interface.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateState, zeroProtoBlock} from "../../../utils/state.js";

const config = createBeaconConfig(
  {
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  },
  Buffer.alloc(32)
);
const parentBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
parentBlock.message.slot = 1;
const root = ssz.gloas.BeaconBlock.hashTreeRoot(parentBlock.message);
const rootHex = toRootHex(root);
const requests = ssz.gloas.ExecutionRequests.deserialize(
  ssz.gloas.ExecutionRequests.serialize({
    ...ssz.gloas.ExecutionRequests.defaultValue(),
    deposits: [ssz.electra.DepositRequest.defaultValue()],
  })
);
const parent = {...zeroProtoBlock, slot: 1, blockRoot: rootHex, payloadStatus: PayloadStatus.FULL};
const dbLogger = testLogger();

describe("BeaconEngine execution requests persistence", () => {
  let db: BeaconDb;
  let directory: string;
  let chain: ReturnType<typeof getMockedBeaconChain>;

  async function openDb(): Promise<BeaconDb> {
    return new BeaconDb(config, await LevelDbController.create({name: directory}, {logger: dbLogger}));
  }

  function setupChain(): void {
    chain = getMockedBeaconChain({config});
    Object.defineProperty(chain, "db", {value: db, configurable: true});
    chain.beaconEngine.getParentExecutionRequests = BeaconEngine.prototype.getParentExecutionRequests.bind(
      chain.beaconEngine
    );
    chain.beaconEngine.importExecutionPayload = BeaconEngine.prototype.importExecutionPayload.bind(chain.beaconEngine);
    chain.forkChoice.onExecutionPayload = vi.fn();
    chain.forkChoice.getHead.mockReturnValue(parent);
    chain.opts.disableImportExecutionFcU = true;
  }

  async function reopenDb(): Promise<void> {
    await db.close();
    db = await openDb();
    // Fresh engine mock so no in-memory state can supply requests.
    setupChain();
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "lodestar-execution-requests-"));
    db = await openDb();
    setupChain();
  });

  afterEach(async () => {
    await db.close();
    await rm(directory, {recursive: true, force: true});
  });

  async function produceChild(): Promise<void> {
    const state = new BeaconStateView(
      createCachedBeaconState(generateState({slot: 1}, config), {
        config,
        pubkeyCache: createPubkeyCache(),
      })
    );
    chain.beaconEngine.payloadAttestationPool.getPayloadAttestationsForBlock = vi.fn().mockReturnValue([]);
    const result = await produceBlockBody.call(chain.beaconEngine, BlockType.Full, state, {
      slot: 2,
      randaoReveal: Buffer.alloc(96),
      graffiti: Buffer.alloc(32),
      parentBlock: parent,
      proposerIndex: 0,
      proposerPubKey: Buffer.alloc(48),
      builderBid: ssz.gloas.SignedExecutionPayloadBid.defaultValue(),
      commonBlockBodyPromise: Promise.resolve(ssz.gloas.BeaconBlockBody.defaultValue()),
    });
    if (!("parentExecutionRequests" in result.body)) throw Error("Expected Gloas body");
    expect(ssz.gloas.ExecutionRequests.equals(result.body.parentExecutionRequests, requests)).toBe(true);
  }

  async function finalize(
    finalizedRoot: Uint8Array,
    ancestors: (typeof parent)[],
    nonAncestors: (typeof parent)[]
  ): Promise<void> {
    chain.forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus.mockReturnValue({ancestors, nonAncestors});
    chain.forkChoice.prune = vi.fn().mockReturnValue([]);
    Object.defineProperty(chain.beaconEngine, "stateArchiveStrategy", {
      value: {maybeArchiveState: vi.fn().mockResolvedValue(undefined)},
      configurable: true,
    });
    await BeaconEngine.prototype.migrateFinalized.call(chain.beaconEngine, {
      epoch: 1,
      root: finalizedRoot,
      rootHex: toRootHex(finalizedRoot),
    });
  }

  it("produces on a FULL parent while the facade envelope write queue is blocked", async () => {
    const input = PayloadEnvelopeInput.createFromBlock({
      block: parentBlock,
      blockRootHex: rootHex,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      timeCreatedSec: 0,
      daOutOfRange: false,
    });
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = root;
    envelope.message.payload.slotNumber = 1;
    envelope.message.executionRequests = requests;
    input.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 0});
    Object.defineProperty(chain, "serializedCache", {value: new Map()});
    const queuedWrite = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    Object.defineProperty(chain, "unfinalizedPayloadEnvelopeWrites", {
      value: {waitForSpace: vi.fn().mockResolvedValue(undefined), push: queuedWrite},
    });
    chain.beaconEngine.verifyExecutionPayloadEnvelope = vi.fn().mockResolvedValue(undefined);
    chain.executionEngine.notifyNewPayload = vi.fn().mockResolvedValue({status: ExecutionPayloadStatus.VALID});

    await importExecutionPayload.call(chain, input, DataAvailabilityStatus.Available);
    expect(queuedWrite).toHaveBeenCalledOnce();
    expect(await db.executionPayloadEnvelope.get(root)).toBeNull();
    await produceChild();
  });

  it("produces on a FULL parent after reopening the DB with an empty envelope store", async () => {
    await chain.beaconEngine.importExecutionPayload(
      root,
      rootHex,
      1,
      30_000_000,
      requests,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );
    await reopenDb();
    expect(await db.executionPayloadEnvelope.get(root)).toBeNull();
    await produceChild();
  });

  it("keeps the pre-Gloas default and rejects missing Gloas requests", async () => {
    vi.spyOn(chain.config, "getForkName").mockReturnValueOnce(ForkName.fulu);
    expect(await chain.beaconEngine.getParentExecutionRequests(0, rootHex)).toEqual(
      ssz.gloas.ExecutionRequests.defaultValue()
    );
    await expect(chain.beaconEngine.getParentExecutionRequests(1, rootHex)).rejects.toThrow(
      `Parent execution requests not found slot=1, root=${rootHex}`
    );
  });

  it("keeps the finalized block's requests and drops the rest of the snapshot", async () => {
    const olderRoot = Buffer.alloc(32, 2);
    const orphanRoot = Buffer.alloc(32, 3);
    const emptyRoot = Buffer.alloc(32, 4);
    const descendantRoot = Buffer.alloc(32, 5);
    await db.executionRequests.batchPut(
      [root, olderRoot, orphanRoot, emptyRoot, descendantRoot].map((key) => ({key, value: requests}))
    );
    for (const [blockRoot, slot] of [
      [root, 1],
      [olderRoot, 0],
    ] as const) {
      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      await db.block.putBinary(blockRoot, ssz.gloas.SignedBeaconBlock.serialize(block));
    }

    // The finalized block is the default (PENDING) variant, as fork choice returns it.
    await finalize(
      root,
      [
        {...parent, payloadStatus: PayloadStatus.PENDING},
        {...parent, blockRoot: toRootHex(olderRoot), slot: 0},
      ],
      [
        {...parent, blockRoot: toRootHex(orphanRoot), slot: 1},
        {...parent, blockRoot: toRootHex(emptyRoot), slot: 1, payloadStatus: PayloadStatus.EMPTY},
        {...parent, payloadStatus: PayloadStatus.EMPTY},
      ]
    );

    for (const blockRoot of [olderRoot, orphanRoot, emptyRoot]) {
      expect(await db.executionRequests.has(blockRoot), `requests remain for ${toRootHex(blockRoot)}`).toBe(false);
    }
    expect(await db.executionRequests.has(descendantRoot)).toBe(true);

    await reopenDb();
    await produceChild();

    // Next finalization drops the previous finalized block's requests.
    await finalize(
      descendantRoot,
      [{...parent, blockRoot: toRootHex(descendantRoot), slot: 2, payloadStatus: PayloadStatus.PENDING}, parent],
      []
    );
    expect(await db.executionRequests.has(root)).toBe(false);
    expect(await db.executionRequests.has(descendantRoot)).toBe(true);
  });
});
