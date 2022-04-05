import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {BeaconStateAllForks, BeaconStateAltair} from "@chainsafe/lodestar-beacon-state-transition";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {routes, Api} from "@chainsafe/lodestar-api";
import {chainConfig as chainConfigDef} from "@chainsafe/lodestar-config/default";
import {createIBeaconConfig, IChainConfig} from "@chainsafe/lodestar-config";
import {Lightclient, LightclientEvent} from "../../src";
import {EventsServerApi, LightclientServerApi, ServerOpts, startServer} from "../lightclientApiServer";
import {
  computeLightclientUpdate,
  computeLightClientSnapshot,
  getInteropSyncCommittee,
  testLogger,
  committeeUpdateToHeadUpdate,
  lastInMap,
} from "../utils";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";

const SOME_HASH = Buffer.alloc(32, 0xff);

describe("Lightclient sync", () => {
  const afterEachCbs: (() => Promise<unknown> | unknown)[] = [];
  afterEach(async () => {
    await Promise.all(afterEachCbs);
    afterEachCbs.length = 0;
  });

  it("Sync lightclient and track head", async () => {
    const SECONDS_PER_SLOT = 2;
    const ALTAIR_FORK_EPOCH = 0;

    const initialPeriod = 0;
    const targetPeriod = 5;
    const slotsIntoPeriod = 8;
    const firstHeadSlot = targetPeriod * EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH;
    const targetSlot = firstHeadSlot + slotsIntoPeriod;

    // Genesis data such that targetSlot is at the current clock slot
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const chainConfig: IChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
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
    const {snapshot, checkpointRoot} = computeLightClientSnapshot(initialPeriod);
    lightclientServerApi.snapshots.set(toHexString(checkpointRoot), snapshot);

    // Populate sync committee updates
    for (let period = initialPeriod; period <= targetPeriod; period++) {
      const committeeUpdate = computeLightclientUpdate(config, period);
      lightclientServerApi.updates.set(period, committeeUpdate);
    }

    // So the first call to getLatestHeadUpdate() doesn't error, store the latest snapshot as latest header update
    lightclientServerApi.latestHeadUpdate = committeeUpdateToHeadUpdate(lastInMap(lightclientServerApi.updates));

    // Initilize from snapshot
    const lightclient = await Lightclient.initializeFromCheckpointRoot({
      config,
      logger: testLogger,
      beaconApiUrl: `http://${opts.host}:${opts.port}`,
      genesisData: {genesisTime, genesisValidatorsRoot},
      checkpointRoot: checkpointRoot,
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

    // Test fetching a proof
    // First create a state with some known data
    const executionStateRoot = Buffer.alloc(32, 0xee);
    const state = ssz.bellatrix.BeaconState.defaultViewDU();
    state.latestExecutionPayloadHeader.stateRoot = executionStateRoot;

    // Track head + reference states with some known data
    const syncCommittee = getInteropSyncCommittee(targetPeriod);
    await new Promise<void>((resolve) => {
      lightclient.emitter.on(LightclientEvent.head, (header) => {
        if (header.slot === targetSlot) {
          resolve();
        }
      });

      for (let slot = firstHeadSlot; slot <= targetSlot; slot++) {
        // Make each stateRoot unique
        state.slot = slot;
        const stateRoot = state.hashTreeRoot();

        // Provide the state to the lightclient server impl. Only the last one to test proof fetching
        if (slot === targetSlot) {
          lightclientServerApi.states.set(toHexString(stateRoot), (state as BeaconStateAllForks) as BeaconStateAltair);
        }

        // Emit a new head update with the custom state root
        const header: phase0.BeaconBlockHeader = {
          slot,
          proposerIndex: 0,
          parentRoot: SOME_HASH,
          stateRoot: stateRoot,
          bodyRoot: SOME_HASH,
        };

        const headUpdate: routes.lightclient.LightclientHeaderUpdate = {
          attestedHeader: header,
          syncAggregate: syncCommittee.signHeader(config, header),
        };

        lightclientServerApi.latestHeadUpdate = headUpdate;
        eventsServerApi.emit({type: routes.events.EventType.lightclientHeaderUpdate, message: headUpdate});
      }
    });

    // Ensure that the lightclient head is correct
    expect(lightclient.getHead().slot).to.equal(targetSlot, "lightclient.head is not the targetSlot head");

    // Fetch proof of "latestExecutionPayloadHeader.stateRoot"
    const {proof, header} = await lightclient.getHeadStateProof([["latestExecutionPayloadHeader", "stateRoot"]]);
    const recoveredState = ssz.bellatrix.BeaconState.createFromProof(proof, header.stateRoot);
    expect(toHexString(recoveredState.latestExecutionPayloadHeader.stateRoot)).to.equal(
      toHexString(executionStateRoot),
      "Recovered executionStateRoot from getHeadStateProof() not correct"
    );
  });
});
