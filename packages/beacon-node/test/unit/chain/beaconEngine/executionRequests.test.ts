import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {PayloadStatus} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {BeaconStateView, DataAvailabilityStatus, createCachedBeaconState} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {SeenEnginePayloadEnvelopeInput} from "../../../../src/chain/beaconEngine/seenEnginePayloadEnvelopeInput.js";
import {importExecutionPayload} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {
  PayloadEnvelopeInput,
  PayloadEnvelopeInputSource,
} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import * as payloadVerification from "../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js";
import {BlockType, produceBlockBody} from "../../../../src/chain/produceBlock/index.js";
import {BeaconDb} from "../../../../src/db/beacon.js";
import {encodeArchivedHeaderEnvelope} from "../../../../src/db/repositories/index.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {toSignedHeaderEnvelope} from "../../../../src/util/headerEnvelope.js";
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
    return new BeaconDb(config, await LevelDbController.create({name: directory}, {logger: dbLogger}), {
      dataColumnDir: path.join(directory, "data_columns"),
      logger: dbLogger,
    });
  }

  function setupChain(): void {
    chain = getMockedBeaconChain({config});
    Object.defineProperty(chain.beaconEngine, "seenPayloadEnvelopeInputCache", {
      value: new SeenEnginePayloadEnvelopeInput({config, forkChoice: chain.forkChoice, db}),
    });
    Object.defineProperty(chain, "db", {value: db, configurable: true});
    chain.beaconEngine.getFinalizedBlockSnapshot = BeaconEngine.prototype.getFinalizedBlockSnapshot.bind(
      chain.beaconEngine
    );
    chain.beaconEngine.getParentExecutionRequests = BeaconEngine.prototype.getParentExecutionRequests.bind(
      chain.beaconEngine
    );
    chain.beaconEngine.importExecutionPayload = vi.fn(
      BeaconEngine.prototype.importExecutionPayload.bind(chain.beaconEngine)
    );
    chain.forkChoice.onExecutionPayload = vi.fn();
    chain.forkChoice.getBlockHex.mockReturnValue(null);
    const state = new BeaconStateView(createCachedBeaconState(generateState({slot: 1}, config), {config, pubkeyCache}));
    chain.regen.getBlockSlotState.mockResolvedValue(state);
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(parent);
    chain.executionEngine.notifyNewPayload = vi.fn().mockResolvedValue({status: ExecutionPayloadStatus.VALID});
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
    vi.spyOn(payloadVerification, "verifyExecutionPayloadEnvelope").mockReturnValue(undefined);
    vi.spyOn(payloadVerification, "verifyExecutionPayloadEnvelopeSignature").mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
    await rm(directory, {recursive: true, force: true});
  });

  async function produceChild(): Promise<void> {
    const state = new BeaconStateView(
      createCachedBeaconState(generateState({slot: 1}, config), {
        config,
        pubkeyCache,
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

  function makeEnvelope() {
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = root;
    envelope.message.payload.slotNumber = 1;
    envelope.message.executionRequests = requests;
    return envelope;
  }

  async function importEnvelope(): Promise<void> {
    const envelope = makeEnvelope();
    await chain.beaconEngine.importExecutionPayload(
      ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
      DataAvailabilityStatus.Available,
      {validSignature: true}
    );
  }

  it("produces on a FULL parent while the facade column write queue is blocked", async () => {
    const input = PayloadEnvelopeInput.createFromBlock({
      block: parentBlock,
      blockRootHex: rootHex,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      seenTimestampSec: 0,
      source: PayloadEnvelopeInputSource.gossip,
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

    await importExecutionPayload.call(chain, input, DataAvailabilityStatus.Available);
    expect(chain.beaconEngine.importExecutionPayload).toHaveBeenCalledExactlyOnceWith(
      ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
      DataAvailabilityStatus.Available,
      {validSignature: false, source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 0}
    );
    expect(queuedWrite).toHaveBeenCalledOnce();
    expect(await db.executionPayloadEnvelope.get(root)).not.toBeNull();
    await produceChild();
  });

  it("produces on a FULL parent after reopening the envelope DB", async () => {
    await importEnvelope();
    await reopenDb();
    await produceChild();
  });

  it("keeps the pre-Gloas default and rejects missing Gloas requests", async () => {
    vi.spyOn(chain.config, "getForkName").mockReturnValueOnce(ForkName.fulu);
    expect(await chain.beaconEngine.getParentExecutionRequests(0, rootHex)).toEqual(
      ssz.gloas.ExecutionRequests.defaultValue()
    );
    await expect(chain.beaconEngine.getParentExecutionRequests(1, rootHex)).rejects.toThrow(
      `Parent execution payload envelope not found slot=1, root=${rootHex}`
    );
  });

  it.each([false, true])(
    "reads parent requests from an archived envelope after restart (header: %s)",
    async (header) => {
      const envelope = makeEnvelope();
      const bytes = header
        ? encodeArchivedHeaderEnvelope(toSignedHeaderEnvelope(envelope))
        : ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope);
      await db.executionPayloadEnvelopeArchive.putBinary(1, bytes);
      await reopenDb();
      expect(await db.executionPayloadEnvelope.get(root)).toBeNull();
      await produceChild();
      expect(chain.executionEngine.getPayload).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    "does not read a different root's archived requests at the same slot (header: %s)",
    async (header) => {
      const envelope = makeEnvelope();
      envelope.message.beaconBlockRoot = Buffer.alloc(32, 99);
      await db.executionPayloadEnvelopeArchive.putBinary(
        1,
        header
          ? encodeArchivedHeaderEnvelope(toSignedHeaderEnvelope(envelope))
          : ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope)
      );
      await expect(chain.beaconEngine.getParentExecutionRequests(1, rootHex)).rejects.toThrow(
        "Parent execution payload envelope not found"
      );
    }
  );
});
