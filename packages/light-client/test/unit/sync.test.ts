import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {routes, Api} from "@chainsafe/lodestar-api";
import {chainConfig} from "@chainsafe/lodestar-config/default";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {Lightclient, LightclientEvent} from "../../src";
import {EventsServerApi, LightclientServerApi, ServerOpts, startServer} from "../lightclientApiServer";
import {computeLightclientUpdate, computeLightClientSnapshot, getInteropSyncCommittee, testLogger} from "../utils";
import {toHexString} from "@chainsafe/ssz";

const SOME_HASH = Buffer.alloc(32, 0xdd);

describe("Lightclient sync", () => {
  const afterEachCbs: (() => Promise<unknown> | unknown)[] = [];
  afterEach(async () => {
    await Promise.all(afterEachCbs);
    afterEachCbs.length = 0;
  });

  it("Sync lightclient and track head", async () => {
    const initialPeriod = 0;
    const targetPeriod = 5;
    const slotsIntoPeriod = 8;
    const firstHeadSlot = targetPeriod * EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH;
    const targetSlot = firstHeadSlot + slotsIntoPeriod;

    // Genesis data such that targetSlot is at the current clock slot
    const genesisTime = Math.floor(Date.now() / 1000) - chainConfig.SECONDS_PER_SLOT * targetSlot;
    const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
    const config = createIBeaconConfig(chainConfig, genesisValidatorsRoot);

    // Create server impl mock backed
    const lightclientServerApi = new LightclientServerApi();
    const eventsServerApi = new EventsServerApi();
    // Start server
    const opts: ServerOpts = {host: "127.0.0.1", port: 15000};
    const server = await startServer(opts, config, ({
      lightclient: lightclientServerApi,
      events: eventsServerApi,
    } as Partial<Api>) as Api);
    afterEachCbs.push(() => server.close());

    // Populate initial snapshot
    const {snapshot, checkpoint} = computeLightClientSnapshot(initialPeriod);
    lightclientServerApi.snapshots.set(toHexString(checkpoint.root), snapshot);

    // Populate sync committee updates
    for (let period = initialPeriod; period <= targetPeriod; period++) {
      lightclientServerApi.updates.set(period, computeLightclientUpdate(config, period));
    }

    // Initilize from snapshot
    const lightclient = await Lightclient.initializeFromCheckpoint({
      config,
      logger: testLogger,
      beaconApiUrl: `http://${opts.host}:${opts.port}`,
      genesisData: {genesisTime, genesisValidatorsRoot},
      checkpoint,
    });
    afterEachCbs.push(() => lightclient.stop());

    // Sync periods to current
    await new Promise<void>((resolve) => {
      lightclient.emitter.on(LightclientEvent.committee, (updatePeriod) => {
        if (updatePeriod === targetPeriod) {
          resolve();
        }
      });
      lightclient.start();
    });

    // Wait for lightclient to subscribe to header updates
    while (!eventsServerApi.hasSubscriptions()) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Track head
    await new Promise<void>((resolve) => {
      lightclient.emitter.on(LightclientEvent.head, (header) => {
        if (header.slot === targetSlot) {
          resolve();
        }
      });

      const syncCommittee = getInteropSyncCommittee(targetPeriod);
      for (let slot = firstHeadSlot; slot <= targetSlot; slot++) {
        const header: phase0.BeaconBlockHeader = {
          slot,
          proposerIndex: 0,
          parentRoot: SOME_HASH,
          stateRoot: SOME_HASH,
          bodyRoot: SOME_HASH,
        };
        const syncAggregate = syncCommittee.signHeader(config, header);

        eventsServerApi.emit({
          type: routes.events.EventType.lightclientUpdate,
          message: {header, syncAggregate},
        });
      }
    });
  });
});
