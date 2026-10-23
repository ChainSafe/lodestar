import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";
import {StatesArchiveOpts} from "../../../../src/chain/archiveStore/interface.js";
import {FrequencyStateArchiveStrategy} from "../../../../src/chain/archiveStore/strategies/frequencyStateArchiveStrategy.js";
import {IStateRegenerator} from "../../../../src/chain/regen/interface.js";
import {BeaconDb} from "../../../../src/db/index.js";
import {startTmpBeaconDb} from "../../../utils/db.js";

describe("chain / archiveStore / FrequencyStateArchiveStrategy", () => {
  const slot = 64;
  const stateRoot = Buffer.alloc(32, 7);
  const finalized: CheckpointWithHex = {epoch: 2, root: Buffer.alloc(32, 2), rootHex: toRootHex(Buffer.alloc(32, 2))};
  const state = ssz.phase0.BeaconState.defaultValue();
  state.slot = slot;
  const stateBytes = ssz.phase0.BeaconState.serialize(state);

  let db: BeaconDb;
  let headState: IBeaconStateView;
  let regen: IStateRegenerator;

  function createStrategy(): FrequencyStateArchiveStrategy {
    return new FrequencyStateArchiveStrategy(regen, () => headState, db, testLogger(), {
      archiveStateEpochFrequency: 1024,
    } as StatesArchiveOpts);
  }

  beforeEach(async () => {
    db = await startTmpBeaconDb(config);
    headState = {
      slot: slot + 100,
      getStateRootAtSlot: (s: number) => (s === slot ? stateRoot : Buffer.alloc(32)),
    } as unknown as IBeaconStateView;
    regen = {getCheckpointStateOrBytes: vi.fn()} as unknown as IStateRegenerator;
  });

  afterEach(async () => {
    await db.close();
  });

  it("indexes a state archived from persisted bytes with the root from the head state", async () => {
    vi.mocked(regen.getCheckpointStateOrBytes).mockResolvedValue(stateBytes);

    await createStrategy().archiveState(finalized);

    expect(toHex((await db.stateArchive.getBinaryByRoot(stateRoot)) ?? new Uint8Array())).toBe(toHex(stateBytes));
  });

  it("archives without index when the slot is out of the head state's history", async () => {
    vi.mocked(regen.getCheckpointStateOrBytes).mockResolvedValue(stateBytes);
    headState = {...headState, slot: slot + SLOTS_PER_HISTORICAL_ROOT + 1} as IBeaconStateView;

    await createStrategy().archiveState(finalized);

    expect(toHex((await db.stateArchive.getBinary(slot)) ?? new Uint8Array())).toBe(toHex(stateBytes));
    expect(await db.stateArchive.getBinaryByRoot(stateRoot)).toBeNull();
  });

  it("indexes a state archived from memory with its own root", async () => {
    const liveState = {
      slot,
      hashTreeRoot: () => stateRoot,
      serializedSize: () => stateBytes.length,
      serialize: () => stateBytes,
    } as unknown as IBeaconStateView;
    vi.mocked(regen.getCheckpointStateOrBytes).mockResolvedValue(liveState);

    await createStrategy().archiveState(finalized);

    expect(toHex((await db.stateArchive.getBinaryByRoot(stateRoot)) ?? new Uint8Array())).toBe(toHex(stateBytes));
  });
});
