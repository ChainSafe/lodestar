import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {testLogger} from "@lodestar/logger/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {
  CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS,
  CURRENT_SYNC_COMMITTEE_GINDEX_GLOAS,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  EXECUTION_BLOCK_HASH_GINDEX_GLOAS,
  FINALIZED_ROOT_DEPTH_GLOAS,
  FINALIZED_ROOT_GINDEX_GLOAS,
  ForkName,
  ForkPostAltair,
  NEXT_SYNC_COMMITTEE_DEPTH_GLOAS,
  NEXT_SYNC_COMMITTEE_GINDEX_GLOAS,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {
  BeaconStateGloas,
  IBeaconStateViewAltair,
  createBeaconStateView,
  isStatePostAltair,
} from "@lodestar/state-transition";
import {BeaconBlock, LightClientUpdate, gloas, ssz} from "@lodestar/types";
import {toRootHex, verifyMerkleBranch} from "@lodestar/utils";
import {
  BlockLightClientCache,
  LightClientServer,
  blockToLightClientHeader,
} from "../../../../src/chain/lightClient/index.js";
import {getSyncCommitteesWitness} from "../../../../src/chain/lightClient/proofs.js";
import {IBeaconDb} from "../../../../src/db/index.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";
import {generateState} from "../../../utils/state.js";

const config = createChainForkConfig({
  ...defaultChainConfig,
  ALTAIR_FORK_EPOCH: 1,
  BELLATRIX_FORK_EPOCH: 2,
  CAPELLA_FORK_EPOCH: 3,
  DENEB_FORK_EPOCH: 4,
  ELECTRA_FORK_EPOCH: 5,
  FULU_FORK_EPOCH: 6,
  GLOAS_FORK_EPOCH: 7,
});
const gloasSlot = 7 * SLOTS_PER_EPOCH;

function zeroBranch(length: number): Uint8Array[] {
  return Array.from({length}, () => new Uint8Array(32));
}

describe("Gloas light client server", () => {
  it("persists native witnesses and serves valid Gloas bootstrap and update branches", async () => {
    const config = createBeaconConfig(getConfig(ForkName.gloas), new Uint8Array(32));
    const value = (generateState({slot: 3 * SLOTS_PER_EPOCH + 3}, config, true) as BeaconStateGloas).toValue();
    value.inactivityScores = value.validators.map(() => 0);
    value.nextSyncCommittee.pubkeys = value.nextSyncCommittee.pubkeys.map(
      (_, i) => value.validators[(i + 1) % value.validators.length].pubkey
    );
    const finalizedBlock = ssz.gloas.BeaconBlock.defaultValue();
    finalizedBlock.slot = SLOTS_PER_EPOCH;
    const finalizedRoot = ssz.gloas.BeaconBlock.hashTreeRoot(finalizedBlock);
    value.finalizedCheckpoint = {epoch: 1, root: finalizedRoot};
    const treeState = ssz.gloas.BeaconState.toViewDU(value);
    const stateRoot = treeState.hashTreeRoot();
    const expectedWitness = getSyncCommitteesWitness(ForkName.gloas, treeState);
    pubkeyCache.ensureCapacity(value.validators.length);
    const native = createBeaconStateView({
      nativeStateTransition: true,
      config,
      stateBytes: treeState.serialize(),
    });
    const {db, close} = await startIsolatedTmpBeaconDb(config, "lodestar-native-light-client-");
    try {
      if (!isStatePostAltair(native)) throw Error("Expected a post-Altair native state");
      const server = new LightClientServer(
        {},
        {
          config,
          db,
          clock: {} as never,
          metrics: null,
          emitter: {} as never,
          logger: testLogger(),
          signal: new AbortController().signal,
        }
      );
      const block = ssz.gloas.BeaconBlock.defaultValue();
      block.slot = value.slot;
      block.stateRoot = stateRoot;
      const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block);
      await db.checkpointHeader.put(finalizedRoot, blockToLightClientHeader(ForkName.gloas, finalizedBlock));

      // Exercise the real import path and repository codec that rejected the old
      // native shared multiproof, then read the persisted witness back from disk.
      await server["onImportBlock"](block, native, block.slot - 1);
      native.release();
      const witness = await db.syncCommitteeWitness.get(blockRoot);
      if (!witness) throw Error("Expected a persisted sync committee witness");
      expect(witness.witness).toEqual([]);
      expect(toRootHex(witness.currentSyncCommitteeRoot)).toBe(toRootHex(expectedWitness.currentSyncCommitteeRoot));
      expect(toRootHex(witness.nextSyncCommitteeRoot)).toBe(toRootHex(expectedWitness.nextSyncCommitteeRoot));
      expect(witness.currentSyncCommitteeBranch?.map(toRootHex)).toEqual(
        expectedWitness.currentSyncCommitteeBranch?.map(toRootHex)
      );
      expect(witness.nextSyncCommitteeBranch?.map(toRootHex)).toEqual(
        expectedWitness.nextSyncCommitteeBranch?.map(toRootHex)
      );
      const bootstrap = await server.getBootstrap(blockRoot);
      expect(() => ssz.gloas.LightClientBootstrap.serialize(bootstrap as gloas.LightClientBootstrap)).not.toThrow();
      expect(
        verifyMerkleBranch(
          ssz.altair.SyncCommittee.hashTreeRoot(bootstrap.currentSyncCommittee),
          bootstrap.currentSyncCommitteeBranch,
          CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS,
          CURRENT_SYNC_COMMITTEE_GINDEX_GLOAS % 2 ** CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS,
          bootstrap.header.beacon.stateRoot
        )
      ).toBe(true);
      bootstrap.currentSyncCommitteeBranch[0][0] ^= 1;
      expect(
        verifyMerkleBranch(
          ssz.altair.SyncCommittee.hashTreeRoot(bootstrap.currentSyncCommittee),
          bootstrap.currentSyncCommitteeBranch,
          CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS,
          CURRENT_SYNC_COMMITTEE_GINDEX_GLOAS % 2 ** CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS,
          bootstrap.header.beacon.stateRoot
        )
      ).toBe(false);

      const attestedData = server["blockData"].get(toRootHex(blockRoot));
      if (!attestedData?.finalizedCheckpoint) throw Error("Expected the native finalized checkpoint proof");
      const built = await server["buildUpdate"](ssz.altair.SyncAggregate.defaultValue(), block.slot + 1, attestedData);
      if (!built) throw Error("Expected a built light-client update");
      await db.bestLightClientUpdate.put(0, built.update);
      const update = await db.bestLightClientUpdate.get(0);
      if (!update) throw Error("Expected a persisted light-client update");
      expect(() => ssz.gloas.LightClientUpdate.serialize(update as gloas.LightClientUpdate)).not.toThrow();
      expect(
        verifyMerkleBranch(
          ssz.altair.SyncCommittee.hashTreeRoot(update.nextSyncCommittee),
          update.nextSyncCommitteeBranch,
          NEXT_SYNC_COMMITTEE_DEPTH_GLOAS,
          NEXT_SYNC_COMMITTEE_GINDEX_GLOAS % 2 ** NEXT_SYNC_COMMITTEE_DEPTH_GLOAS,
          update.attestedHeader.beacon.stateRoot
        )
      ).toBe(true);
      update.nextSyncCommitteeBranch[0][0] ^= 1;
      expect(
        verifyMerkleBranch(
          ssz.altair.SyncCommittee.hashTreeRoot(update.nextSyncCommittee),
          update.nextSyncCommitteeBranch,
          NEXT_SYNC_COMMITTEE_DEPTH_GLOAS,
          NEXT_SYNC_COMMITTEE_GINDEX_GLOAS % 2 ** NEXT_SYNC_COMMITTEE_DEPTH_GLOAS,
          update.attestedHeader.beacon.stateRoot
        )
      ).toBe(false);
      expect(ssz.phase0.BeaconBlockHeader.hashTreeRoot(update.finalizedHeader.beacon)).toEqual(finalizedRoot);
      expect(
        verifyMerkleBranch(
          finalizedRoot,
          update.finalityBranch,
          FINALIZED_ROOT_DEPTH_GLOAS,
          FINALIZED_ROOT_GINDEX_GLOAS % 2 ** FINALIZED_ROOT_DEPTH_GLOAS,
          update.attestedHeader.beacon.stateRoot
        )
      ).toBe(true);
      update.finalityBranch[0][0] ^= 1;
      expect(
        verifyMerkleBranch(
          finalizedRoot,
          update.finalityBranch,
          FINALIZED_ROOT_DEPTH_GLOAS,
          FINALIZED_ROOT_GINDEX_GLOAS % 2 ** FINALIZED_ROOT_DEPTH_GLOAS,
          update.attestedHeader.beacon.stateRoot
        )
      ).toBe(false);
    } finally {
      native.release();
      await close();
    }
  });

  it("creates a header with a valid execution block hash proof", () => {
    const block = ssz.gloas.BeaconBlock.defaultValue();
    block.slot = gloasSlot;
    block.body.signedExecutionPayloadBid.message.parentBlockHash = new Uint8Array(32).fill(0xaa);

    const header = blockToLightClientHeader(ForkName.gloas, block);
    if (!("executionBlockHash" in header)) {
      throw Error("Expected a Gloas light client header");
    }

    const depth = Math.floor(Math.log2(Number(EXECUTION_BLOCK_HASH_GINDEX_GLOAS)));
    const index = Number(EXECUTION_BLOCK_HASH_GINDEX_GLOAS) % 2 ** depth;
    expect(header.executionBlockHash).toEqual(block.body.signedExecutionPayloadBid.message.parentBlockHash);
    expect(
      verifyMerkleBranch(header.executionBlockHash, header.executionBranch, depth, index, header.beacon.bodyRoot)
    ).toBe(true);
  });

  it("stores a serializable non-finality update with Gloas zero values", async () => {
    const putBestUpdate = vi.fn(async (_period: number, _update: LightClientUpdate) => undefined);
    const nextSyncCommitteeRoot = new Uint8Array(32).fill(0xbb);
    const syncCommitteeWitness = {
      witness: [],
      currentSyncCommitteeRoot: new Uint8Array(32).fill(0xaa),
      nextSyncCommitteeRoot,
      currentSyncCommitteeBranch: zeroBranch(CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS),
      nextSyncCommitteeBranch: zeroBranch(NEXT_SYNC_COMMITTEE_DEPTH_GLOAS),
    };
    const nextSyncCommittee = ssz.altair.SyncCommittee.defaultValue();
    const db = {
      bestLightClientUpdate: {get: vi.fn(async () => null), put: putBestUpdate},
      syncCommitteeWitness: {get: vi.fn(async () => syncCommitteeWitness)},
      syncCommittee: {get: vi.fn(async () => nextSyncCommittee)},
    } as unknown as IBeaconDb;
    const server = new LightClientServer(
      {},
      {
        config,
        db,
        clock: {} as never,
        metrics: null,
        emitter: {} as never,
        logger: {debug: vi.fn(), error: vi.fn()} as never,
        signal: new AbortController().signal,
      }
    );
    const attestedHeader = ssz.gloas.LightClientHeader.defaultValue();
    attestedHeader.beacon.slot = gloasSlot;
    const attestedData: BlockLightClientCache = {
      attestedHeader,
      blockRoot: new Uint8Array(32),
      syncAggregate: ssz.altair.SyncAggregate.defaultValue(),
      signatureSlot: gloasSlot,
      bestUpdateRoot: null,
      bestUpdateSummary: null,
      latestSignatureSlot: gloasSlot,
      finalizedCheckpoint: null,
      finalityBranch: null,
    };

    const built = await server["buildUpdate"](ssz.altair.SyncAggregate.defaultValue(), gloasSlot + 1, attestedData);
    const nextBuilt = await server["buildUpdate"](ssz.altair.SyncAggregate.defaultValue(), gloasSlot + 1, attestedData);
    if (!built || !nextBuilt) throw Error("Expected built light-client updates");
    await db.bestLightClientUpdate.put(0, built.update);
    await db.bestLightClientUpdate.put(0, nextBuilt.update);

    expect(putBestUpdate).toHaveBeenCalledTimes(2);
    const update = putBestUpdate.mock.calls[0][1] as gloas.LightClientUpdate;
    const nextUpdate = putBestUpdate.mock.calls[1][1] as gloas.LightClientUpdate;
    const zeroUpdate = ssz.gloas.LightClientUpdate.defaultValue();
    expect(update.finalizedHeader).toEqual(zeroUpdate.finalizedHeader);
    expect(update.finalityBranch).toEqual(zeroUpdate.finalityBranch);
    expect(nextUpdate.finalizedHeader).toBe(update.finalizedHeader);
    expect(nextUpdate.finalityBranch).toBe(update.finalityBranch);
    expect(() => ssz.gloas.LightClientUpdate.serialize(update)).not.toThrow();
  });

  it("serves the finality branch with an empty finalized header at genesis", async () => {
    const finalityBranch = Array.from({length: FINALIZED_ROOT_DEPTH_GLOAS}, (_, i) => new Uint8Array(32).fill(i + 1));
    const {server} = createServerForFinalityTest();

    const built = await server["buildUpdate"](ssz.altair.SyncAggregate.defaultValue(), gloasSlot + 1, {
      ...createBlockData(gloasSlot),
      finalizedCheckpoint: {epoch: 0, root: new Uint8Array(32)},
      finalityBranch,
    });

    const zeroUpdate = ssz.gloas.LightClientUpdate.defaultValue();
    expect(built?.hasFinality).toBe(true);
    expect(built?.update.finalizedHeader).toEqual(zeroUpdate.finalizedHeader);
    expect(built?.update.finalityBranch).toEqual(finalityBranch);
  });

  it("serves no finality when the finalized header is not available", async () => {
    const {server} = createServerForFinalityTest();

    const built = await server["buildUpdate"](ssz.altair.SyncAggregate.defaultValue(), gloasSlot + 1, {
      ...createBlockData(gloasSlot),
      finalizedCheckpoint: {epoch: 1, root: new Uint8Array(32).fill(0xcc)},
      finalityBranch: Array.from({length: FINALIZED_ROOT_DEPTH_GLOAS}, () => new Uint8Array(32).fill(0xdd)),
    });

    const zeroUpdate = ssz.gloas.LightClientUpdate.defaultValue();
    expect(built?.hasFinality).toBe(false);
    expect(built?.update.finalizedHeader).toEqual(zeroUpdate.finalizedHeader);
    expect(built?.update.finalityBranch).toEqual(zeroUpdate.finalityBranch);
  });
});

describe("LightClientServer.updateHead", () => {
  const MAX_CACHED_SLOTS = 4 * EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH;

  function chainOf(slots: number[], tag = 0): Map<string, BlockLightClientCache> {
    const map = new Map<string, BlockLightClientCache>();
    let parent: Uint8Array = new Uint8Array(32);
    for (const slot of slots) {
      const data = createBlockData(slot);
      data.attestedHeader.beacon.parentRoot = parent;
      // Distinguishes branches that hold blocks at the same slots
      data.attestedHeader.beacon.proposerIndex = tag;
      data.blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(data.attestedHeader.beacon);
      data.bestUpdateRoot = toRootHex(data.blockRoot);
      data.latestSignatureSlot = slot;
      map.set(toRootHex(data.blockRoot), data);
      parent = data.blockRoot;
    }
    return map;
  }

  function blockAt(chain: Map<string, BlockLightClientCache>, slot: number): BlockLightClientCache {
    for (const data of chain.values()) {
      if (data.attestedHeader.beacon.slot === slot) return data;
    }
    throw Error(`No block at slot ${slot}`);
  }

  function createServer(stored: LightClientUpdate | null): {
    server: LightClientServer;
    putBestUpdate: ReturnType<typeof vi.fn>;
    deleteBestUpdate: ReturnType<typeof vi.fn>;
  } {
    const putBestUpdate = vi.fn(async () => undefined);
    const deleteBestUpdate = vi.fn(async () => undefined);
    // Pre-Electra witness, the slots used here are in the Altair fork
    const db = {
      bestLightClientUpdate: {
        get: vi.fn(async () => stored),
        put: putBestUpdate,
        delete: deleteBestUpdate,
      },
      syncCommitteeWitness: {
        get: vi.fn(async () => ({
          witness: zeroBranch(4),
          currentSyncCommitteeRoot: new Uint8Array(32).fill(0xaa),
          nextSyncCommitteeRoot: new Uint8Array(32).fill(0xbb),
        })),
        put: vi.fn(async () => undefined),
      },
      syncCommittee: {
        get: vi.fn(async () => ssz.altair.SyncCommittee.defaultValue()),
        has: vi.fn(async () => true),
        putBinary: vi.fn(async () => undefined),
      },
      checkpointHeader: {get: vi.fn(async () => null), put: vi.fn(async () => undefined)},
    } as unknown as IBeaconDb;
    const server = new LightClientServer(
      {},
      {
        config,
        db,
        clock: {} as never,
        metrics: null,
        emitter: {emit: vi.fn()} as never,
        logger: {debug: vi.fn(), error: vi.fn()} as never,
        signal: new AbortController().signal,
      }
    );
    return {server, putBestUpdate, deleteBestUpdate};
  }

  function setBlockData(server: LightClientServer, data: Map<string, BlockLightClientCache>): void {
    for (const [rootHex, blockData] of data) server["blockData"].set(rootHex, blockData);
  }
  it("keeps the finalized block when its epoch starts with empty slots", async () => {
    const {server} = createServer(null);
    const epochStart = SLOTS_PER_EPOCH;
    const finalizedBlockSlot = epochStart + 8;
    const chain = chainOf([epochStart, finalizedBlockSlot, finalizedBlockSlot + 10]);
    setBlockData(server, chain);

    await server.updateHead(blockAt(chain, finalizedBlockSlot + 10).blockRoot, {
      epoch: 1,
      root: blockAt(chain, finalizedBlockSlot).blockRoot,
    });

    const remaining = [...server["blockData"].values()].map((data) => data.attestedHeader.beacon.slot);
    expect(remaining.sort((a, b) => a - b)).toEqual([finalizedBlockSlot, finalizedBlockSlot + 10]);
  });
  it("leaves served updates untouched when the branch is not cached down to a period", async () => {
    const {server, putBestUpdate, deleteBestUpdate} = createServer(ssz.gloas.LightClientUpdate.defaultValue());
    const headSlot = EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH + 100;
    // The head's parent is missing from the cache, so the walk back to the first period stops
    const head = createBlockData(headSlot);
    head.blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(head.attestedHeader.beacon);
    head.bestUpdateRoot = toRootHex(head.blockRoot);
    head.latestSignatureSlot = headSlot;
    server["blockData"].set(toRootHex(head.blockRoot), head);

    await server.updateHead(head.blockRoot, {epoch: 0, root: new Uint8Array(32)});

    expect(deleteBestUpdate).not.toHaveBeenCalled();
    expect(putBestUpdate).not.toHaveBeenCalled();
  });
  it("bounds the cache on import, without updateHead", async () => {
    const {server} = createServer(null);
    const blockSlot = gloasSlot + MAX_CACHED_SLOTS + 16;
    setBlockData(server, chainOf([blockSlot - MAX_CACHED_SLOTS - 1]));

    await server["onImportBlock"](createStubBlock(blockSlot), createStubState(), blockSlot - 1);

    const remaining = [...server["blockData"].values()].map((data) => data.attestedHeader.beacon.slot);
    expect(remaining).toEqual([blockSlot]);
  });
});

function createStubBlock(slot: number): BeaconBlock<ForkPostAltair> {
  const block = ssz.gloas.BeaconBlock.defaultValue() as BeaconBlock<ForkPostAltair>;
  block.slot = slot;
  return block;
}

function createStubState(): IBeaconStateViewAltair {
  return {
    currentSyncCommittee: ssz.altair.SyncCommittee.defaultValue(),
    nextSyncCommittee: ssz.altair.SyncCommittee.defaultValue(),
    finalizedCheckpoint: {epoch: 0, root: new Uint8Array(32)},
    getSyncCommitteesWitness: () => ({
      witness: [],
      currentSyncCommitteeRoot: new Uint8Array(32).fill(0xaa),
      nextSyncCommitteeRoot: new Uint8Array(32).fill(0xbb),
      currentSyncCommitteeBranch: zeroBranch(CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS),
      nextSyncCommitteeBranch: zeroBranch(NEXT_SYNC_COMMITTEE_DEPTH_GLOAS),
    }),
    getFinalizedRootProof: () => zeroBranch(FINALIZED_ROOT_DEPTH_GLOAS),
  } as unknown as IBeaconStateViewAltair;
}

function createBlockData(slot: number): BlockLightClientCache {
  const attestedHeader = ssz.gloas.LightClientHeader.defaultValue();
  attestedHeader.beacon.slot = slot;
  return {
    attestedHeader,
    blockRoot: new Uint8Array(32),
    syncAggregate: ssz.altair.SyncAggregate.defaultValue(),
    signatureSlot: slot,
    bestUpdateRoot: null,
    bestUpdateSummary: null,
    latestSignatureSlot: slot,
    finalizedCheckpoint: null,
    finalityBranch: null,
  };
}

function createServerForFinalityTest(): {server: LightClientServer} {
  const db = {
    bestLightClientUpdate: {get: vi.fn(async () => null), put: vi.fn(async () => undefined)},
    syncCommitteeWitness: {
      get: vi.fn(async () => ({
        witness: [],
        currentSyncCommitteeRoot: new Uint8Array(32).fill(0xaa),
        nextSyncCommitteeRoot: new Uint8Array(32).fill(0xbb),
        currentSyncCommitteeBranch: zeroBranch(CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS),
        nextSyncCommitteeBranch: zeroBranch(NEXT_SYNC_COMMITTEE_DEPTH_GLOAS),
      })),
    },
    syncCommittee: {get: vi.fn(async () => ssz.altair.SyncCommittee.defaultValue())},
    // Finalized header is never available in this setup
    checkpointHeader: {get: vi.fn(async () => null)},
  } as unknown as IBeaconDb;
  const server = new LightClientServer(
    {},
    {
      config,
      db,
      clock: {} as never,
      metrics: null,
      emitter: {} as never,
      logger: {debug: vi.fn(), error: vi.fn()} as never,
      signal: new AbortController().signal,
    }
  );
  return {server};
}
