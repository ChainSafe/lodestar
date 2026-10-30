import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {createBeaconStateViewForHistoricalRegen} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {getHistoricalState} from "../../../../src/chain/archiveStore/historicalState/getHistoricalState.js";
import {BeaconDb} from "../../../../src/db/index.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";
import {generateState} from "../../../utils/state.js";

describe("chain / archiveStore / getHistoricalState", () => {
  const config = createBeaconConfig(chainConfig, Buffer.alloc(32, 0));
  let db: BeaconDb;
  let closeDb: () => Promise<void>;
  let stateBytes: Uint8Array;

  beforeEach(async () => {
    ({db, close: closeDb} = await startIsolatedTmpBeaconDb(chainConfig, "lodestar-historical-state-"));
    stateBytes = generateState({slot: 0}, chainConfig).serialize();
    await db.stateArchive.putBinary(0, stateBytes);
  });

  afterEach(async () => {
    await closeDb();
  });

  it("replays archived blocks that extend the nearest state", async () => {
    const state = createBeaconStateViewForHistoricalRegen({nativeStateTransition: false, config, stateBytes});
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.proposerIndex = state.getBeaconProposer(1);
    block.message.parentRoot = state.computeAnchorCheckpoint().checkpoint.root;
    await db.blockArchive.add(block);

    const bytes = await getHistoricalState(1, config, db, false);

    expect(ssz.phase0.BeaconState.deserialize(bytes).slot).toBe(1);
  });

  it("rejects archived blocks that do not extend the nearest state", async () => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = 64;
    block.message.parentRoot = Buffer.alloc(32, 1);
    await db.blockArchive.add(block);

    await expect(getHistoricalState(64, config, db, false)).rejects.toThrow(
      "Archived blocks do not extend nearest state slot=0 blockSlot=64"
    );
  });
});
