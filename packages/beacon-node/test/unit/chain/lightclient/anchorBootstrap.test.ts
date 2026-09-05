import {describe, expect, it, vi} from "vitest";
import {BeaconStateView, isStatePostAltair} from "@lodestar/state-transition";
import {LightClientBootstrap, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {LightClientServer} from "../../../../src/chain/lightClient/index.js";
import {IBeaconDb} from "../../../../src/db/index.js";
import {generateCachedAltairState} from "../../../utils/state.js";

/**
 * After checkpoint sync the anchor block is never imported through `onImportBlockHead`, so the server
 * must be able to persist bootstrap data for it from the anchor state alone (plus the block once fetched).
 */
describe("LightClientServer anchor bootstrap", () => {
  it("persists witness, header and committees so getBootstrap works for the anchor root", async () => {
    const cachedState = generateCachedAltairState({slot: 8});
    const anchorState = new BeaconStateView(cachedState);
    if (!isStatePostAltair(anchorState)) throw Error("expected altair state");

    const anchorBlock = ssz.altair.BeaconBlock.defaultValue();
    anchorBlock.slot = 8;
    anchorBlock.stateRoot = cachedState.hashTreeRoot();
    const anchorRoot = ssz.altair.BeaconBlock.hashTreeRoot(anchorBlock);

    // In-memory stand-ins for the three repositories getBootstrap reads
    const witnesses = new Map<string, unknown>();
    const committees = new Map<string, Uint8Array>();
    const headers = new Map<string, unknown>();
    const db = {
      syncCommitteeWitness: {
        put: vi.fn(async (root: Uint8Array, w: unknown) => void witnesses.set(toRootHex(root), w)),
        get: vi.fn(async (root: Uint8Array) => witnesses.get(toRootHex(root)) ?? null),
      },
      syncCommittee: {
        has: vi.fn(async (root: Uint8Array) => committees.has(toRootHex(root))),
        putBinary: vi.fn(async (root: Uint8Array, bytes: Uint8Array) => void committees.set(toRootHex(root), bytes)),
        get: vi.fn(async (root: Uint8Array) => {
          const bytes = committees.get(toRootHex(root));
          return bytes ? ssz.altair.SyncCommittee.deserialize(bytes) : null;
        }),
      },
      checkpointHeader: {
        put: vi.fn(async (root: Uint8Array, h: unknown) => void headers.set(toRootHex(root), h)),
        get: vi.fn(async (root: Uint8Array) => headers.get(toRootHex(root)) ?? null),
      },
    } as unknown as IBeaconDb;

    const server = new LightClientServer(
      {},
      {
        config: cachedState.config,
        db,
        clock: {} as never,
        metrics: null,
        emitter: {} as never,
        logger: {debug: vi.fn(), error: vi.fn()} as never,
        signal: new AbortController().signal,
      }
    );

    // Before: nothing persisted for the anchor root
    await expect(server.getBootstrap(anchorRoot)).rejects.toThrow(/syncCommitteeWitness not available/);

    await server.persistAnchorBootstrapData(anchorBlock, anchorState);

    const bootstrap: LightClientBootstrap = await server.getBootstrap(anchorRoot);
    expect(ssz.phase0.BeaconBlockHeader.hashTreeRoot(bootstrap.header.beacon)).toEqual(anchorRoot);
    expect(ssz.altair.SyncCommittee.hashTreeRoot(bootstrap.currentSyncCommittee)).toEqual(
      ssz.altair.SyncCommittee.hashTreeRoot(anchorState.currentSyncCommittee)
    );
    expect(bootstrap.currentSyncCommitteeBranch.length).toBeGreaterThan(0);

    // Both committees referenced by the witness were stored, each exactly once
    expect(db.syncCommittee.putBinary).toHaveBeenCalledTimes(2);

    // Calling again is idempotent and does not re-store committees
    await server.persistAnchorBootstrapData(anchorBlock, anchorState);
    expect(db.syncCommittee.putBinary).toHaveBeenCalledTimes(2);
  });
});
