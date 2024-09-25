import {describe, it, expect, afterEach, vi} from "vitest";
import {JsonPath, toHexString} from "@chainsafe/ssz";
import {CompactMultiProof, computeDescriptor} from "@chainsafe/persistent-merkle-tree";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateAllForks, BeaconStateAltair} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";
import {routes, getClient, ApiClient} from "@lodestar/api";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {createBeaconConfig, ChainConfig} from "@lodestar/config";
import {Lightclient, LightclientEvent} from "../../src/index.js";
import {LightclientServerApiMock, ProofServerApiMock} from "../mocks/LightclientServerApiMock.js";
import {EventsServerApiMock} from "../mocks/EventsServerApiMock.js";
import {
  computeLightclientUpdate,
  computeLightClientSnapshot,
  getInteropSyncCommittee,
  testLogger,
  committeeUpdateToLatestHeadUpdate,
  committeeUpdateToLatestFinalizedHeadUpdate,
  lastInMap,
} from "../utils/utils.js";
import {startServer, ServerOpts} from "../utils/server.js";
import {computeSyncPeriodAtSlot} from "../../src/utils/clock.js";
import {LightClientRestTransport} from "../../src/transport/rest.js";

const SOME_HASH = Buffer.alloc(32, 0xff);

describe("sync", () => {
  vi.setConfig({testTimeout: 30_000});
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
    const chainConfig: ChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
    const genesisTime = Math.floor(Date.now() / 1000) - chainConfig.SECONDS_PER_SLOT * targetSlot;
    const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
    const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

    // Create server impl mock backed
    const lightclientServerApi = new LightclientServerApiMock();
    const eventsServerApi = new EventsServerApiMock();
    const proofServerApi = new ProofServerApiMock();
    // Start server
    const opts: ServerOpts = {host: "127.0.0.1", port: 15000};
    await startServer(opts, config, {
      lightclient: lightclientServerApi,
      events: eventsServerApi,
      proof: proofServerApi,
    });

    // Populate initial snapshot
    const {snapshot, checkpointRoot} = computeLightClientSnapshot(initialPeriod);
    lightclientServerApi.snapshots.set(toHexString(checkpointRoot), snapshot);

    // Populate sync committee updates
    for (let period = initialPeriod; period <= targetPeriod; period++) {
      const committeeUpdate = computeLightclientUpdate(config, period);
      lightclientServerApi.updates.set(period, committeeUpdate);
    }

    // So the first call to getLatestHeadUpdate() doesn't error, store the latest snapshot as latest header update
    lightclientServerApi.latestHeadUpdate = committeeUpdateToLatestHeadUpdate(lastInMap(lightclientServerApi.updates));
    lightclientServerApi.finalized = committeeUpdateToLatestFinalizedHeadUpdate(
      lastInMap(lightclientServerApi.updates),
      targetSlot
    );

    const api = getClient({baseUrl: `http://${opts.host}:${opts.port}`}, {config});

    // Initialize from snapshot
    const lightclient = await Lightclient.initializeFromCheckpointRoot({
      config,
      logger: testLogger,
      transport: new LightClientRestTransport(api),
      genesisData: {genesisTime, genesisValidatorsRoot},
      checkpointRoot: checkpointRoot,
      opts: {
        // Trigger `LightclientEvent.finalized` events for the Promise below
        allowForcedUpdates: true,
        updateHeadersOnForcedUpdate: true,
      },
    });
    afterEachCbs.push(() => lightclient.stop());

    // Sync periods to current
    await new Promise<void>((resolve) => {
      lightclient.emitter.on(LightclientEvent.lightClientFinalityHeader, (header) => {
        if (computeSyncPeriodAtSlot(header.beacon.slot) >= targetPeriod) {
          resolve();
        }
      });
      void lightclient.start();
    });

    // Wait for lightclient to subscribe to header updates
    while (!eventsServerApi.hasSubscriptions()) {
      await new Promise((r) => setTimeout(r, 100));
    }

    // Test fetching a proof
    // First create a state with some known data
    const executionStateRoot = Buffer.alloc(32, 0xee);
    const state = ssz.bellatrix.BeaconState.defaultViewDU();
    state.latestExecutionPayloadHeader.stateRoot = executionStateRoot;

    // Track head + reference states with some known data
    const syncCommittee = getInteropSyncCommittee(targetPeriod);
    await new Promise<void>((resolve) => {
      lightclient.emitter.on(LightclientEvent.lightClientOptimisticHeader, (header) => {
        if (header.beacon.slot === targetSlot) {
          resolve();
        }
      });

      for (let slot = firstHeadSlot; slot <= targetSlot; slot++) {
        // Make each stateRoot unique
        state.slot = slot;
        const stateRoot = state.hashTreeRoot();

        // Provide the state to the lightclient server impl. Only the last one to test proof fetching
        if (slot === targetSlot) {
          proofServerApi.states.set(toHexString(stateRoot), state as BeaconStateAllForks as BeaconStateAltair);
        }

        // Emit a new head update with the custom state root
        const header: altair.LightClientHeader = {
          beacon: {
            slot,
            proposerIndex: 0,
            parentRoot: SOME_HASH,
            stateRoot: stateRoot,
            bodyRoot: SOME_HASH,
          },
        };

        const headUpdate: altair.LightClientOptimisticUpdate = {
          attestedHeader: header,
          syncAggregate: syncCommittee.signHeader(config, header),
          signatureSlot: header.beacon.slot + 1,
        };

        lightclientServerApi.latestHeadUpdate = headUpdate;
        eventsServerApi.emit({
          type: routes.events.EventType.lightClientOptimisticUpdate,
          message: {version: config.getForkName(headUpdate.attestedHeader.beacon.slot), data: headUpdate},
        });
        testLogger.debug("Emitted EventType.lightClientOptimisticUpdate", {slot});
      }
    });

    // Ensure that the lightclient head is correct
    expect(lightclient.getHead().beacon.slot).toBe(targetSlot);

    // Fetch proof of "latestExecutionPayloadHeader.stateRoot"
    const {proof, header} = await getHeadStateProof(lightclient, api, [["latestExecutionPayloadHeader", "stateRoot"]]);

    const recoveredState = ssz.bellatrix.BeaconState.createFromProof(proof, header.beacon.stateRoot);
    expect(toHexString(recoveredState.latestExecutionPayloadHeader.stateRoot)).toBe(toHexString(executionStateRoot));
  });
});

// TODO: Re-incorporate for REST-only light-client
async function getHeadStateProof(
  lightclient: Lightclient,
  api: ApiClient,
  paths: JsonPath[]
): Promise<{proof: CompactMultiProof; header: altair.LightClientHeader}> {
  const header = lightclient.getHead();
  const stateId = toHexString(header.beacon.stateRoot);
  const gindices = paths.map((path) => ssz.bellatrix.BeaconState.getPathInfo(path).gindex);
  const descriptor = computeDescriptor(gindices);
  const proof = (await api.proof.getStateProof({stateId, descriptor})).value();

  return {proof, header};
}
