// Branch ownership regressions retained separately from the incoming req/resp suite.
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PeerId} from "@libp2p/interface";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {PayloadStatus} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {fromAsync, toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../src/api/impl/beacon/blocks/index.js";
import {archiveBlocks} from "../../../../../src/chain/archiveStore/utils/archiveBlocks.js";
import {BeaconEngineCore} from "../../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {
  PayloadEnvelopeInput,
  PayloadEnvelopeInputSource,
} from "../../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {BeaconChain} from "../../../../../src/chain/chain.js";
import {BeaconDb} from "../../../../../src/db/beacon.js";
import {onExecutionPayloadEnvelopesByRange} from "../../../../../src/network/reqresp/handlers/executionPayloadEnvelopesByRange.js";
import {onExecutionPayloadEnvelopesByRoot} from "../../../../../src/network/reqresp/handlers/executionPayloadEnvelopesByRoot.js";
import {getMockedBeaconChain, withBeaconEngineFacade} from "../../../../mocks/mockedBeaconChain.js";
import {getMockedNetwork} from "../../../../mocks/mockedNetwork.js";
import {zeroProtoBlock} from "../../../../utils/state.js";

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
const block = ssz.gloas.SignedBeaconBlock.defaultValue();
block.message.slot = 1;
const root = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
const rootHex = toRootHex(root);
const protoBlock = {...zeroProtoBlock, slot: 1, blockRoot: rootHex, payloadStatus: PayloadStatus.FULL};
const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
envelope.message.beaconBlockRoot = root;
envelope.message.payload.slotNumber = 1;
const envelopeBytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope);
const peerId = {toString: () => "test-peer"} as PeerId;

describe("facade execution payload envelope serving", () => {
  let db: BeaconDb;
  let directory: string;
  let chain: ReturnType<typeof getMockedBeaconChain>;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "lodestar-envelopes-"));
    db = new BeaconDb(config, await LevelDbController.create({name: directory}, {logger: testLogger()}), {
      dataColumnDir: path.join(directory, "columns"),
      logger: testLogger(),
    });
    chain = getMockedBeaconChain({config});
    Object.defineProperty(chain, "db", {value: db});
    Object.defineProperty(chain, "serializedCache", {value: new Map()});
    chain.getSerializedExecutionPayloadEnvelopes = vi.fn(
      BeaconChain.prototype.getSerializedExecutionPayloadEnvelopes.bind(chain)
    );
    chain.beaconEngine.chainView.getFinalizedBlock = vi.fn().mockReturnValue({...protoBlock, slot: 0});
    chain.beaconEngine.chainView.getHead = vi.fn().mockReturnValue(protoBlock);
    chain.beaconEngine.chainView.getAllAncestorBlocks = vi.fn().mockReturnValue([protoBlock]);
    chain.getSerializedExecutionPayloadEnvelope = vi.fn(
      BeaconChain.prototype.getSerializedExecutionPayloadEnvelope.bind(chain)
    );
    chain.getExecutionPayloadEnvelope = vi.fn(BeaconChain.prototype.getExecutionPayloadEnvelope.bind(chain));
    chain.beaconEngine.chainView.getBlockHexDefaultStatus = vi.fn().mockReturnValue(protoBlock);
  });

  afterEach(async () => {
    await db.close();
    await rm(directory, {recursive: true, force: true});
  });

  it("serves a cached envelope before its DB write lands", async () => {
    const input = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex: rootHex,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      seenTimestampSec: 0,
      source: PayloadEnvelopeInputSource.gossip,
      daOutOfRange: false,
    });
    input.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 0});
    vi.mocked(chain.seenPayloadEnvelopeInputCache.get).mockImplementation((key) =>
      key === rootHex ? input : undefined
    );
    expect(await db.executionPayloadEnvelope.get(root)).toBeNull();

    chain.beaconEngine.chainView.getFullBlockRootSlotsByRange = vi
      .fn()
      .mockReturnValue({finalizedSlot: 1, nonFinalized: [{slot: 1, root}]});
    expect(
      (await fromAsync(onExecutionPayloadEnvelopesByRange({startSlot: 1, count: 1}, chain, db, peerId, "test"))).map(
        (r) => r.data
      )
    ).toEqual([envelopeBytes]);
    expect(
      (await fromAsync(onExecutionPayloadEnvelopesByRoot([root], chain, db, peerId, "test"))).map((r) => r.data)
    ).toEqual([envelopeBytes]);

    chain.getBlockByRoot.mockResolvedValue({
      block: ssz.gloas.SignedBeaconBlock.serialize(block),
      slot: block.message.slot,
      executionOptimistic: false,
      finalized: false,
    });
    const api = getBeaconBlockApi({
      chain: withBeaconEngineFacade(chain),
      config,
      metrics: null,
      network: getMockedNetwork(),
    });
    expect((await api.getSignedExecutionPayloadEnvelope({blockId: rootHex}, {returnBytes: true})).data).toEqual(
      envelopeBytes
    );
    expect((await api.getSignedExecutionPayloadEnvelope({blockId: rootHex})).data).toBe(envelope);
  });

  it("serves persisted envelopes from hot DB and the cold archive stream", async () => {
    const orphanRoot = Buffer.alloc(32, 5);
    await db.executionPayloadEnvelope.put(root, envelope);
    await db.executionPayloadEnvelope.put(orphanRoot, envelope);
    expect(Uint8Array.from((await chain.getSerializedExecutionPayloadEnvelope(1, rootHex)) ?? [])).toEqual(
      envelopeBytes
    );

    const blockSnapshot = {
      canonical: [protoBlock],
      nonCanonical: [{...protoBlock, blockRoot: toRootHex(orphanRoot)}],
    };
    chain.beaconEngine.migrateExecutionPayloadEnvelopes =
      BeaconEngineCore.prototype.migrateExecutionPayloadEnvelopes.bind(chain.beaconEngine);
    chain.beaconEngine.deleteNonCanonicalExecutionPayloadEnvelopes =
      BeaconEngineCore.prototype.deleteNonCanonicalExecutionPayloadEnvelopes.bind(chain.beaconEngine);
    chain.beaconEngine.migrateCanonicalBlocks = vi.fn().mockResolvedValue([]);
    chain.beaconEngine.deleteNonCanonicalBlocks = vi.fn().mockResolvedValue(undefined);
    chain.opts.dedupePayloads = false;
    chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: 1, root, rootHex});
    chain.forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus.mockReturnValue({
      ancestors: [protoBlock],
      nonAncestors: [],
    });
    await archiveBlocks(
      config,
      db,
      chain.beaconEngine,
      blockSnapshot,
      chain.logger,
      {epoch: 1, root, rootHex},
      1,
      undefined,
      false,
      undefined
    );
    expect(await db.executionPayloadEnvelope.get(root)).toBeNull();
    expect(await db.executionPayloadEnvelope.get(orphanRoot)).toBeNull();

    chain.beaconEngine.chainView.getFinalizedBlock = vi.fn().mockReturnValue({...protoBlock, slot: 2});
    expect(
      (await fromAsync(onExecutionPayloadEnvelopesByRange({startSlot: 0, count: 2}, chain, db, peerId, "test"))).map(
        (r) => Uint8Array.from(r.data)
      )
    ).toEqual([envelopeBytes]);
    expect(
      (await fromAsync(onExecutionPayloadEnvelopesByRoot([root], chain, db, peerId, "test"))).map((r) =>
        Uint8Array.from(r.data)
      )
    ).toEqual([envelopeBytes]);
  });
});
