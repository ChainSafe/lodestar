import {PeerId} from "@libp2p/interface";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {ZERO_HASH} from "../../../../../src/constants/index.js";
import {BeaconDb} from "../../../../../src/db/index.js";
import {onBeaconBlocksByRange} from "../../../../../src/network/reqresp/handlers/beaconBlocksByRange.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../../../../../src/util/sszBytes.js";
import {startIsolatedTmpBeaconDb} from "../../../../utils/db.js";

describe("onBeaconBlocksByRange", () => {
  const config = createBeaconConfig(chainConfig, ZERO_HASH);
  const peerId = {toString: () => "test-peer"} as PeerId;
  let db: BeaconDb;
  let closeDb: () => Promise<void>;

  beforeEach(async () => {
    ({db, close: closeDb} = await startIsolatedTmpBeaconDb(config, "lodestar-blocks-by-range-"));
  });

  afterEach(() => closeDb());

  it("streams archived blocks in slot order and skips empty slots", async () => {
    for (const slot of [10, 12]) {
      const block = ssz.phase0.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      await db.blockArchive.putBinary(slot, ssz.phase0.SignedBeaconBlock.serialize(block));
    }

    const chain = {
      config,
      earliestAvailableSlot: 0,
      beaconEngine: {
        chainView: {
          getCanonicalBlockRootSlotsByRange: () => ({finalizedSlot: 12, nonFinalized: []}),
        },
      },
    } as unknown as IBeaconChain;

    const responses = await Array.fromAsync(
      onBeaconBlocksByRange({startSlot: 10, count: 4, step: 1}, chain, db, peerId, "test-client")
    );

    expect(responses.map(({data}) => getSlotFromSignedBeaconBlockSerialized(data))).toEqual([10, 12]);
  });
});
