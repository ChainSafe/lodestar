import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {aggregateSerializedPublicKeys} from "@chainsafe/blst";
import {HttpHeader, getClient, routes} from "@lodestar/api";
import {ChainConfig, createBeaconConfig} from "@lodestar/config";
import {ForkName, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {Validator} from "@lodestar/validator";
import {BeaconNode} from "../../../../../src/node/nodejs.js";
import {waitForEvent} from "../../../../utils/events/resolver.js";
import {LogLevel, TestLoggerOpts, testLogger} from "../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../../../utils/node/validator.js";

describe("lightclient api", () => {
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

  it.skip("getLightClientCommitteeRoot() for the 1st period", async () => {
    // need to investigate why this test fails after upgrading to electra
    // TODO: https://github.com/ChainSafe/lodestar/issues/8723
    await waitForBestUpdate();

    const lightclient = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const committeeRes = await lightclient.getLightClientCommitteeRoot({startPeriod: 0, count: 1});
    committeeRes.assertOk();
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).beacon;
    const validators = (await client.postStateValidators({stateId: "head"})).value();
    const pubkeys = validators.map((v) => v.validator.pubkey);
    expect(pubkeys.length).toBe(validatorCount);
    // only 2 validators spreading to 512 committee slots
    const committeePubkeys = Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) =>
      i % 2 === 0 ? pubkeys[0] : pubkeys[1]
    );
    const aggregatePubkey = aggregateSerializedPublicKeys(committeePubkeys).toBytes();
    // single committee hash since we requested for the first period
    expect(committeeRes.value()).toEqual([
      ssz.altair.SyncCommittee.hashTreeRoot({
        pubkeys: committeePubkeys,
        aggregatePubkey,
      }),
    ]);
  });
});
