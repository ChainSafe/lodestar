import {describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {testLogger} from "@lodestar/logger/test-utils";
import {
  CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS,
  CURRENT_SYNC_COMMITTEE_GINDEX_GLOAS,
  EXECUTION_BLOCK_HASH_GINDEX_GLOAS,
  FINALIZED_ROOT_DEPTH_GLOAS,
  FINALIZED_ROOT_GINDEX_GLOAS,
  ForkName,
  NEXT_SYNC_COMMITTEE_DEPTH_GLOAS,
  NEXT_SYNC_COMMITTEE_GINDEX_GLOAS,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {BeaconStateGloas, createBeaconStateView, isStatePostAltair} from "@lodestar/state-transition";
import {LightClientUpdate, gloas, ssz} from "@lodestar/types";
import {toRootHex, verifyMerkleBranch} from "@lodestar/utils";
import {
  LightClientServer,
  SyncAttestedData,
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
      await server["persistPostBlockImportData"](block, native, block.slot - 1);
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

      const attestedData = server["prevHeadData"].get(toRootHex(blockRoot));
      if (!attestedData?.isFinalized) throw Error("Expected the native finalized checkpoint proof");
      await server["maybeStoreNewBestUpdate"](0, ssz.altair.SyncAggregate.defaultValue(), block.slot + 1, attestedData);
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
    const attestedData: SyncAttestedData = {
      attestedHeader,
      blockRoot: new Uint8Array(32),
      isFinalized: false,
    };

    await server["maybeStoreNewBestUpdate"](0, ssz.altair.SyncAggregate.defaultValue(), gloasSlot + 1, attestedData);
    await server["maybeStoreNewBestUpdate"](0, ssz.altair.SyncAggregate.defaultValue(), gloasSlot + 1, attestedData);

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
});
