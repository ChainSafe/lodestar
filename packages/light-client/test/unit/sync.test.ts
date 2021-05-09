import {expect} from "chai";
import {SecretKey} from "@chainsafe/bls";
import {altair} from "@chainsafe/lodestar-types";
import {createExtraMinimalConfig} from "../utils";
import {processLightClientUpdate} from "../../src/client/update";
import {computeSyncPeriodAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {List} from "@chainsafe/ssz";
import {LightclientMockServer} from "../lightclientMockServer";

/* eslint-disable @typescript-eslint/naming-convention */

describe("Lightclient flow with LightClientUpdater", () => {
  const config = createExtraMinimalConfig();

  before("BLS sanity check", () => {
    const sk = SecretKey.fromBytes(Buffer.alloc(32, 1));
    expect(sk.toPublicKey().toHex()).to.equal(
      "0xaa1a1c26055a329817a5759d877a2795f9499b97d6056edde0eea39512f24e8bc874b4471f0501127abb1ea0d9f68ac1"
    );
  });

  // Fixed params
  const genValiRoot = Buffer.alloc(32, 9);

  it("Run chain for a few periods", async () => {
    const lightclientServer = new LightclientMockServer(config, genValiRoot);

    // Create blocks and state
    const fromSlot = 1;
    const toSlot = 150;
    // Compute all periods until toSlot
    const lastPeriod = computeSyncPeriodAtSlot(config, toSlot);
    const periods = Array.from({length: lastPeriod + 1}, (_, i) => i);

    for (let slot = fromSlot; slot <= toSlot; slot++) {
      lightclientServer.createNewBlock(slot);
    }

    // Check the current state of updates
    const lightClientUpdater = lightclientServer["lightClientUpdater"];
    const bestUpdates = await lightClientUpdater.getBestUpdates(periods);
    const latestFinalizedUpdate = await lightClientUpdater.getLatestUpdateFinalized();
    const latestNonFinalizedUpdate = await lightClientUpdater.getLatestUpdateNonFinalized();

    expect({
      bestUpdates: bestUpdates.map((u) => u.header.slot),
      latestFinalizedUpdate: latestFinalizedUpdate?.header.slot,
      latestNonFinalizedUpdate: latestNonFinalizedUpdate?.header.slot,
    }).to.deep.equal({
      bestUpdates: [55, 119, 149],
      latestFinalizedUpdate: 119,
      latestNonFinalizedUpdate: 149,
    });

    // Simulate a Lightclient syncing to latest update with these updates

    const store: altair.LightClientStore = {
      snapshot: {
        header: config.types.altair.BeaconBlockHeader.defaultValue(),
        currentSyncCommittee: {pubkeys: lightclientServer["getSyncCommittee"](0).pks, pubkeyAggregates: []},
        nextSyncCommittee: {pubkeys: lightclientServer["getSyncCommittee"](1).pks, pubkeyAggregates: []},
      },
      validUpdates: ([] as altair.LightClientUpdate[]) as List<altair.LightClientUpdate>,
    };

    for (const [i, update] of bestUpdates.entries()) {
      // Skip first update since it's already known in the snapshot
      if (i === 0) continue;
      try {
        processLightClientUpdate(config, store, update, toSlot, genValiRoot);
      } catch (e) {
        (e as Error).message = `Error processing update ${i}: ${(e as Error).message}`;
        throw e;
      }
    }

    expect(store.snapshot.header.slot).to.equal(149, "Wrong store.snapshot.header.slot after applying updates");
  });
});
