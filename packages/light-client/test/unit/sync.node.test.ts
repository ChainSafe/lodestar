import {afterEach, describe, expect, it, vi} from "vitest";
import {CompactMultiProof, computeDescriptor} from "@chainsafe/persistent-merkle-tree";
import {JsonPath, toHexString} from "@chainsafe/ssz";
import {ApiClient, getClient, routes} from "@lodestar/api";
import {ChainConfig, createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateAllForks, BeaconStateAltair} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";
import {Lightclient, LightclientEvent} from "../../src/index.js";
import {LightClientRestTransport} from "../../src/transport/rest.js";
import {computeSyncPeriodAtSlot} from "../../src/utils/clock.js";
import {EventsServerApiMock} from "../mocks/EventsServerApiMock.js";
import {LightclientServerApiMock, ProofServerApiMock} from "../mocks/LightclientServerApiMock.js";
import {ServerOpts, startServer} from "../utils/server.js";
import {
  committeeUpdateToLatestFinalizedHeadUpdate,
  committeeUpdateToLatestHeadUpdate,
  computeLightClientSnapshot,
  computeLightclientUpdate,
  getInteropSyncCommittee,
  lastInMap,
  testLogger,
} from "../utils/utils.js";

const SOME_HASH = Buffer.alloc(32, 0xff);

describe("sync", () => {
  // Increase timeout to 60 seconds to give test enough time
  vi.setConfig({testTimeout: 60_000});
  const afterEachCbs: (() => Promise<unknown> | unknown)[] = [];

  afterEach(async () => {
    await Promise.all(afterEachCbs);
    afterEachCbs.length = 0;
  });

  it("Sync lightclient and track head", async () => {
    const SLOT_DURATION_MS = 2000;
    const ALTAIR_FORK_EPOCH = 0;

    const initialPeriod = 0;
    const targetPeriod = 5;
    const slotsIntoPeriod = 8;
    const firstHeadSlot = targetPeriod * EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH;
    const targetSlot = firstHeadSlot + slotsIntoPeriod;

    // Genesis data such that targetSlot is at the current clock slot
    const chainConfig: ChainConfig = {...chainConfigDef, SLOT_DURATION_MS, ALTAIR_FORK_EPOCH};
    const genesisTime = Math.floor(Date.now() / 1000) - (chainConfig.SLOT_DURATION_MS / 1000) * targetSlot;
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

    // Sync periods to current with timeout
    testLogger.debug("Starting lightclient and waiting for finality header");
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const currentHead = lightclient.getHead();
          const currentPeriod = computeSyncPeriodAtSlot(currentHead.beacon.slot);
          reject(
            new Error(
              `Timeout waiting for lightClientFinalityHeader to reach period ${targetPeriod}. ` +
                `Current slot: ${currentHead.beacon.slot}, period: ${currentPeriod}`
            )
          );
        }, 50000); // 50 second timeout

        let receivedCount = 0;
        lightclient.emitter.on(LightclientEvent.lightClientFinalityHeader, (header: {beacon: {slot: number}}) => {
          receivedCount++;
          const currentPeriod = computeSyncPeriodAtSlot(header.beacon.slot);
          testLogger.debug(`Received lightClientFinalityHeader #${receivedCount}`, {
            slot: header.beacon.slot,
            period: currentPeriod,
            targetPeriod,
          });
          if (currentPeriod >= targetPeriod) {
            clearTimeout(timeout);
            testLogger.debug("Target period reached, resolving");
            resolve();
          }
        });

        testLogger.debug("Starting lightclient...");
        void lightclient.start();
      }),
    ]);

    testLogger.debug("Waiting for event subscriptions");
    // Wait for lightclient to subscribe to header updates with timeout
    const subscriptionTimeout = Date.now() + 10000; // 10 second timeout
    while (!eventsServerApi.hasSubscriptions()) {
      if (Date.now() > subscriptionTimeout) {
        throw new Error("Timeout waiting for event subscriptions");
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    testLogger.debug("Event subscriptions established, preparing state");

    // Test fetching a proof
    // First create a state with some known data
    const executionStateRoot = Buffer.alloc(32, 0xee);
    const state = ssz.bellatrix.BeaconState.defaultViewDU();
    state.latestExecutionPayloadHeader.stateRoot = executionStateRoot;

    // Track head + reference states with some known data
    const syncCommittee = getInteropSyncCommittee(targetPeriod);

    testLogger.debug("Starting head tracking", {firstHeadSlot, targetSlot});

    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const currentSlot = lightclient.getHead().beacon.slot;
          reject(
            new Error(`Timeout waiting for optimistic header at slot ${targetSlot}. ` + `Current slot: ${currentSlot}`)
          );
        }, 50000); // 50 second timeout

        let receivedCount = 0;
        lightclient.emitter.on(LightclientEvent.lightClientOptimisticHeader, (header: {beacon: {slot: number}}) => {
          receivedCount++;
          testLogger.debug(`Received lightClientOptimisticHeader #${receivedCount}`, {
            slot: header.beacon.slot,
            targetSlot,
          });
          if (header.beacon.slot === targetSlot) {
            clearTimeout(timeout);
            testLogger.debug("Target slot reached, resolving");
            resolve();
          }
        });

        // Emit events with delay to allow processing
        (async () => {
          testLogger.debug("Starting event emission loop");
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

            if (slot % 10 === 0 || slot === targetSlot) {
              testLogger.debug("Emitted EventType.lightClientOptimisticUpdate", {slot, targetSlot});
            }

            // Reduced delay for faster test execution
            await new Promise((r) => setTimeout(r, 20));
          }
          testLogger.debug("Completed event emission loop");
        })().catch((err) => {
          testLogger.error("Error in event emission loop", err);
          reject(err);
        });
      }),
    ]);

    testLogger.debug("Head tracking complete, verifying results");

    // Ensure that the lightclient head is correct
    expect(lightclient.getHead().beacon.slot).toBe(targetSlot);

    testLogger.debug("Fetching proof");
    // Fetch proof of "latestExecutionPayloadHeader.stateRoot"
    const {proof, header} = await getHeadStateProof(lightclient, api, [["latestExecutionPayloadHeader", "stateRoot"]]);

    testLogger.debug("Verifying proof");
    const recoveredState = ssz.bellatrix.BeaconState.createFromProof(proof, header.beacon.stateRoot);
    expect(toHexString(recoveredState.latestExecutionPayloadHeader.stateRoot)).toBe(toHexString(executionStateRoot));

    testLogger.debug("Test completed successfully");
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
