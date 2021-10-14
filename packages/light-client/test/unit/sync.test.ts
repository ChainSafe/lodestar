import {expect} from "chai";
import {SecretKey} from "@chainsafe/bls";
import {chainConfig} from "@chainsafe/lodestar-config/default";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {toHexString} from "@chainsafe/ssz";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {altair, phase0, Root, Slot, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
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
  let genesisCheckpoint: phase0.Checkpoint;

  // Create blocks and state
  const fromSlot = 1;
  const toSlot = 100;
  const validatorCount = 4;

  // Ensure it's running minimal, or the asserted epochs will be wrong
  if (chainConfig.PRESET_BASE !== "minimal") {
    throw Error("Must run test with 'LODESTAR_PRESET=minimal'");
  }
  // Custom config to activate altair on genesis
  const customConfig: typeof chainConfig = {
    ...chainConfig,
    ALTAIR_FORK_EPOCH: 0,
  };
  const config = createIChainForkConfig(customConfig);

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
    // Choose genesisTime so that the toSlot is the current after initialization
    const genesisTime = Math.floor(Date.now() / 1000) - toSlot * config.SECONDS_PER_SLOT;

    // Create genesis state and block
    const genesisState = ssz.altair.BeaconState.defaultTreeBacked();
    const genesisBlock = ssz.altair.BeaconBlock.defaultValue();
    genesisState.validators = generateValidators(validatorCount);
    genesisValidatorsRoot = ssz.altair.BeaconState.fields["validators"].hashTreeRoot(genesisState.validators);
    genesisState.genesisValidatorsRoot = genesisValidatorsRoot;
    genesisState.genesisTime = genesisTime;
    genesisState.balances = generateBalances(validatorCount);
    genesisState.currentSyncCommittee = getInteropSyncCommittee(0).syncCommittee;
    genesisState.nextSyncCommittee = getInteropSyncCommittee(1).syncCommittee;
    genesisStateRoot = ssz.altair.BeaconState.hashTreeRoot(genesisState);
    genesisBlock.stateRoot = genesisStateRoot;
    genesisCheckpoint = {
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
      bestUpdates: [40, 80],
      latestFinalizedUpdate: 80,
      latestNonFinalizedUpdate: 99,
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
        processLightClientUpdate(store, update, toSlot, genesisValidatorsRoot);
      } catch (e) {
        (e as Error).message = `Error processing update ${i}: ${(e as Error).message}`;
        throw e;
      }
    }

    expect(store.snapshot.header.slot).to.equal(80, "Wrong store.snapshot.header.slot after applying updates");
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

    expect(lightclient.getHeader().slot).to.equal(80, "Wrong store.snapshot.header.slot after applying updates");
  });

  it.skip("Simulate a second lightclient syncing over the API from a checkpoint", async () => {
    const lightclient = await Lightclient.initializeFromCheckpoint(config, beaconApiUrl, genesisCheckpoint);

    await lightclient.sync();

    expect(lightclient.getHeader().slot).to.equal(80, "Wrong store.snapshot.header.slot after applying updates");
  });
});

class MockClock implements IClock {
  readonly genesisTime = 0;
  constructor(readonly currentSlot: Slot) {}
  start(): void {
    //
  }
  runEverySlot(): void {
    //
  }
}
