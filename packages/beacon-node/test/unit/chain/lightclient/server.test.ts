import {describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {
  CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS,
  EXECUTION_BLOCK_HASH_GINDEX_GLOAS,
  ForkName,
  NEXT_SYNC_COMMITTEE_DEPTH_GLOAS,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {LightClientUpdate, gloas, ssz} from "@lodestar/types";
import {verifyMerkleBranch} from "@lodestar/utils";
import {
  LightClientServer,
  SyncAttestedData,
  blockToLightClientHeader,
} from "../../../../src/chain/lightClient/index.js";
import {IBeaconDb} from "../../../../src/db/index.js";

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
