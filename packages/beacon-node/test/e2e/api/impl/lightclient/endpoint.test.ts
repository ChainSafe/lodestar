import {describe, it, beforeEach, afterEach, expect} from "vitest";
import bls from "@chainsafe/bls";
import {createBeaconConfig, ChainConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {ApiError, getClient, routes} from "@lodestar/api";
import {sleep} from "@lodestar/utils";
import {ForkName, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {Validator} from "@lodestar/validator";
import {phase0, ssz} from "@lodestar/types";
import {LogLevel, testLogger, TestLoggerOpts} from "../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../../../utils/node/validator.js";
import {BeaconNode} from "../../../../../src/node/nodejs.js";
import {waitForEvent} from "../../../../utils/events/resolver.js";

/* eslint-disable @typescript-eslint/naming-convention */
describe("lightclient api", function () {
  const SECONDS_PER_SLOT = 1;
  const ALTAIR_FORK_EPOCH = 0;
  const restPort = 9596;
  const chainConfig: ChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);
  const testLoggerOpts: TestLoggerOpts = {level: LogLevel.info};
  const loggerNodeA = testLogger("lightclient-api", testLoggerOpts);
  const validatorCount = 2;

  let bn: BeaconNode;
  let validators: Validator[];
  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];

  beforeEach(async () => {
    bn = await getDevBeaconNode({
      params: chainConfig,
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
    await waitForEvent(
      bn.chain.emitter,
      routes.events.EventType.lightClientOptimisticUpdate,
      5 * SECONDS_PER_SLOT * 1000
    );
    // wait for 1 slot to persist the best update
    await sleep(2 * SECONDS_PER_SLOT * 1000);
  };

  it("getUpdates()", async function () {
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    await waitForBestUpdate();
    const res = await client.getUpdates(0, 1);
    ApiError.assert(res);
    const updates = res.response;
    expect(updates.length).toBe(1);
    // best update could be any slots
    // version is set
    expect(updates[0].version).toBe(ForkName.altair);
  });

  it("getOptimisticUpdate()", async function () {
    await waitForBestUpdate();
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const res = await client.getOptimisticUpdate();
    ApiError.assert(res);
    const update = res.response;
    const slot = bn.chain.clock.currentSlot;
    // at slot 2 we got attestedHeader for slot 1
    expect(update.data.attestedHeader.beacon.slot).toBe(slot - 1);
    // version is set
    expect(update.version).toBe(ForkName.altair);
  });

  it.skip("getFinalityUpdate()", async function () {
    // TODO: not sure how this causes subsequent tests failed
    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, routes.events.EventType.finalizedCheckpoint, 240000);
    await sleep(SECONDS_PER_SLOT * 1000);
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const res = await client.getFinalityUpdate();
    ApiError.assert(res);
    expect(res.response).toBeDefined();
  });

  it("getCommitteeRoot() for the 1st period", async function () {
    await waitForBestUpdate();

    const lightclient = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const committeeRes = await lightclient.getCommitteeRoot(0, 1);
    ApiError.assert(committeeRes);
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).beacon;
    const validatorResponse = await client.getStateValidators("head");
    ApiError.assert(validatorResponse);
    const pubkeys = validatorResponse.response.data.map((v) => v.validator.pubkey);
    expect(pubkeys.length).toBe(validatorCount);
    // only 2 validators spreading to 512 committee slots
    const committeePubkeys = Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) =>
      i % 2 === 0 ? pubkeys[0] : pubkeys[1]
    );
    const aggregatePubkey = bls.aggregatePublicKeys(committeePubkeys);
    // single committe hash since we requested for the first period
    expect(committeeRes.response.data).toEqual([
      ssz.altair.SyncCommittee.hashTreeRoot({
        pubkeys: committeePubkeys,
        aggregatePubkey,
      }),
    ]);
  });
});
