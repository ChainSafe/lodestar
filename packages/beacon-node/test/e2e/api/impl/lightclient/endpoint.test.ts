import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {HttpHeader, getClient, routes} from "@lodestar/api";
import {ChainConfig, createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {CachedBeaconStateAltair} from "@lodestar/state-transition";
import {phase0} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {Validator} from "@lodestar/validator";
import {BeaconNode} from "../../../../../src/node/nodejs.js";
import {waitForEvent} from "../../../../utils/events/resolver.js";
import {LogLevel, TestLoggerOpts, testLogger} from "../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../../../utils/node/validator.js";

describe("lightclient api", () => {
  vi.setConfig({testTimeout: 10_000});

  const SLOT_DURATION_MS = 1000;
  const restPort = 9596;
  const ELECTRA_FORK_EPOCH = 0;
  const FULU_FORK_EPOCH = 1;
  const testParams: Partial<ChainConfig> = {
    SLOT_DURATION_MS,
    ALTAIR_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    BELLATRIX_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    CAPELLA_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    DENEB_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    ELECTRA_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    FULU_FORK_EPOCH: FULU_FORK_EPOCH,
  };

  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(testParams, genesisValidatorsRoot);
  const testLoggerOpts: TestLoggerOpts = {level: LogLevel.info};
  const loggerNodeA = testLogger("lightclient-api", testLoggerOpts);
  const validatorCount = 2;

  let bn: BeaconNode;
  let validators: Validator[];
  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];

  beforeEach(async () => {
    bn = await getDevBeaconNode({
      params: testParams,
      options: {
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true},
        api: {
          rest: {
            enabled: true,
            port: restPort,
            api: ["lightclient"],
          },
        },
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      logger: loggerNodeA,
    });
    afterEachCallbacks.push(() => bn.close());

    validators = (
      await getAndInitDevValidators({
        node: bn,
        logPrefix: "lightclient-api",
        validatorsPerClient: validatorCount,
        validatorClientCount: 1,
        startIndex: 0,
        useRestApi: false,
        testLoggerOpts,
      })
    ).validators;
    afterEachCallbacks.push(() => Promise.all(validators.map((validator) => validator.close())));
  });

  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  const waitForBestUpdate = async (): Promise<void> => {
    // should see this event in 5 slots
    await waitForEvent(bn.chain.emitter, routes.events.EventType.lightClientOptimisticUpdate, 5 * SLOT_DURATION_MS);
    // wait for 1 slot to persist the best update
    await sleep(2 * SLOT_DURATION_MS);
  };

  it("getLightClientUpdatesByRange()", async () => {
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    await waitForBestUpdate();
    const res = await client.getLightClientUpdatesByRange({startPeriod: 0, count: 1});
    const updates = res.value();
    expect(updates.length).toBe(1);
    // best update could be any slots
    // version is set
    expect(res.meta().versions[0]).toBe(ForkName.electra);
  });

  it("getLightClientOptimisticUpdate()", async () => {
    await waitForBestUpdate();
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const res = await client.getLightClientOptimisticUpdate();
    const update = res.value();
    const slot = bn.chain.clock.currentSlot;
    // at slot 2 we got attestedHeader for slot 1
    expect(update.attestedHeader.beacon.slot).toBe(slot - 1);
    // version is set
    expect(res.meta().version).toBe(ForkName.electra);
    // Ensure version header is made available to scripts running in the browser
    expect(res.headers.get(HttpHeader.ExposeHeaders)?.includes("Eth-Consensus-Version")).toBe(true);
  });

  it.skip("getLightClientFinalityUpdate()", async () => {
    // TODO: not sure how this causes subsequent tests failed
    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, routes.events.EventType.finalizedCheckpoint, 240000);
    await sleep(SLOT_DURATION_MS);
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const finalityUpdate = (await client.getLightClientFinalityUpdate()).value();
    expect(finalityUpdate).toBeDefined();
  });

  it("getLightClientCommitteeRoot() for the 1st period", async () => {
    await waitForBestUpdate();

    const lightclient = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const committeeRes = await lightclient.getLightClientCommitteeRoot({startPeriod: 0, count: 1});
    committeeRes.assertOk();

    // Get the actual sync committee root from the head state
    // The sync committee is computed using a weighted random shuffle, not simple alternation
    // Since the test starts at Electra, headState is always post-Altair and has currentSyncCommittee
    const headState = bn.chain.getHeadState() as CachedBeaconStateAltair;
    const expectedRoot = headState.currentSyncCommittee.hashTreeRoot();

    // single committee hash since we requested for the first period
    expect(committeeRes.value()).toEqual([expectedRoot]);
  });
});
