import {expect} from "chai";
import {SecretKey} from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/minimal";
import {toHexString} from "@chainsafe/ssz";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {altair, Root, Slot, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {computeSyncPeriodAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {LightclientMockServer} from "../lightclientMockServer";
import {processLightClientUpdate} from "../../src/client/update";
import {LightClientStoreFast} from "../../src/client/types";
import {Lightclient} from "../../src/client";
import {ServerOpts} from "../lightclientApiServer";
import {IClock} from "../../src/utils/clock";
import {generateBalances, generateValidators, getInteropSyncCommittee} from "../utils";

/* eslint-disable @typescript-eslint/naming-convention, no-console */

describe("Lightclient flow with LightClientUpdater", () => {
  let lightclientServer: LightclientMockServer;
  let genesisStateRoot: Root;
  let genesisValidatorsRoot: Root;

  // Create blocks and state
  const fromSlot = 1;
  const toSlot = 50;
  const validatorCount = 4;

  // Compute all periods until toSlot
  const lastPeriod = computeSyncPeriodAtSlot(toSlot);
  const periods = Array.from({length: lastPeriod + 1}, (_, i) => i);

  const serverOpts: ServerOpts = {port: 31000, host: "0.0.0.0"};
  const beaconApiUrl = `http://${serverOpts.host}:${serverOpts.port}`;

  before("BLS sanity check", () => {
    const sk = SecretKey.fromBytes(Buffer.alloc(32, 1));
    expect(sk.toPublicKey().toHex()).to.equal(
      "0xaa1a1c26055a329817a5759d877a2795f9499b97d6056edde0eea39512f24e8bc874b4471f0501127abb1ea0d9f68ac1"
    );
  });

  const afterCallbacks: (() => Promise<void> | void)[] = [];
  after(async () => {
    while (afterCallbacks.length > 0) {
      const callback = afterCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("Run LightclientMockServer for a few periods", async () => {
    // Create genesis state and block
    const genesisState = ssz.altair.BeaconState.defaultTreeBacked();
    const genesisBlock = ssz.altair.BeaconBlock.defaultValue();
    genesisState.validators = generateValidators(validatorCount);
    genesisState.balances = generateBalances(validatorCount);
    genesisState.currentSyncCommittee = getInteropSyncCommittee(config, 0).syncCommittee;
    genesisState.nextSyncCommittee = getInteropSyncCommittee(config, 1).syncCommittee;
    genesisValidatorsRoot = ssz.altair.BeaconState.fields["validators"].hashTreeRoot(genesisState.validators);
    genesisStateRoot = ssz.altair.BeaconState.hashTreeRoot(genesisState);
    genesisBlock.stateRoot = genesisStateRoot;
    const genesisCheckpoint: altair.Checkpoint = {
      root: ssz.altair.BeaconBlock.hashTreeRoot(genesisBlock),
      epoch: 0,
    };

    // TEMP log genesis for lightclient client
    console.log({
      genesisStateRoot: toHexString(genesisStateRoot),
      genesisValidatorsRoot: toHexString(genesisValidatorsRoot),
    });

    const logger = new WinstonLogger();
    lightclientServer = new LightclientMockServer(config, logger, genesisValidatorsRoot);
    await lightclientServer.initialize({block: genesisBlock, state: genesisState, checkpoint: genesisCheckpoint});

    for (let slot = fromSlot; slot <= toSlot; slot++) {
      await lightclientServer.createNewBlock(slot);
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
      bestUpdates: [4, 20, 36, 49],
      latestFinalizedUpdate: 36,
      latestNonFinalizedUpdate: 49,
    });

    // Start API server

    await lightclientServer.startApiServer(serverOpts);
    afterCallbacks.push(() => lightclientServer.stopApiServer());
  });

  it("Simulate a Lightclient syncing to latest update with these updates in memory", async () => {
    const store: LightClientStoreFast = {
      bestUpdates: new Map<SyncPeriod, altair.LightClientUpdate>(),
      snapshot: {
        header: ssz.phase0.BeaconBlockHeader.defaultValue(),
        currentSyncCommittee: lightclientServer["getSyncCommittee"](0).syncCommitteeFast,
        nextSyncCommittee: lightclientServer["getSyncCommittee"](1).syncCommitteeFast,
      },
    };

    const bestUpdates = await lightclientServer["lightClientUpdater"].getBestUpdates(periods);
    for (const [i, update] of bestUpdates.entries()) {
      try {
        processLightClientUpdate(config, store, update, toSlot, genesisValidatorsRoot);
      } catch (e) {
        (e as Error).message = `Error processing update ${i}: ${(e as Error).message}`;
        throw e;
      }
    }

    expect(store.snapshot.header.slot).to.equal(36, "Wrong store.snapshot.header.slot after applying updates");
  });

  it("Simulate a second lightclient syncing over the API from trusted snapshot", async () => {
    const clock = new MockClock(toSlot);
    const snapshot: altair.LightClientSnapshot = {
      header: ssz.phase0.BeaconBlockHeader.defaultValue(),
      currentSyncCommittee: lightclientServer["getSyncCommittee"](0).syncCommittee,
      nextSyncCommittee: lightclientServer["getSyncCommittee"](1).syncCommittee,
    };
    const lightclient = Lightclient.initializeFromTrustedSnapshot(
      {config, clock, genesisValidatorsRoot, beaconApiUrl},
      snapshot
    );

    await lightclient.sync();

    expect(lightclient.getHeader().slot).to.equal(36, "Wrong store.snapshot.header.slot after applying updates");
  });

  it("Simulate a second lightclient syncing over the API from trusted stateRoot", async () => {
    const clock = new MockClock(toSlot);
    const lightclient = await Lightclient.initializeFromTrustedStateRoot(
      {config, clock, genesisValidatorsRoot, beaconApiUrl},
      {stateRoot: genesisStateRoot, slot: 0}
    );

    await lightclient.sync();

    expect(lightclient.getHeader().slot).to.equal(36, "Wrong store.snapshot.header.slot after applying updates");
  });
});

class MockClock implements IClock {
  constructor(readonly currentSlot: Slot) {}
  start(): void {
    //
  }
  runEverySlot(): void {
    //
  }
}
