import {expect} from "chai";
import {createBeaconConfig, ChainConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {ApiError, getClient, routes} from "@lodestar/api";
import {sleep} from "@lodestar/utils";
import {ForkName, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {Validator} from "@lodestar/validator";
import {phase0, ssz} from "@lodestar/types";
import bls from "@chainsafe/bls";
import {LogLevel, testLogger, TestLoggerOpts} from "../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../../../utils/node/validator.js";
import {BeaconNode} from "../../../../../src/node/nodejs.js";
import {waitForEvent} from "../../../../utils/events/resolver.js";

/* eslint-disable @typescript-eslint/naming-convention */
describe("lightclient api", function () {
  this.timeout("10 min");

  const SECONDS_PER_SLOT = 1;
  const ALTAIR_FORK_EPOCH = 0;
  const restPort = 9596;
  const chainConfig: ChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);
  const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
  const loggerNodeA = testLogger("Node-A", testLoggerOpts);
  const validatorCount = 2;

  let bn: BeaconNode;
  let validators: Validator[];
  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];

  this.beforeEach(async () => {
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

  it("getUpdates()", async function () {
    await sleep(2 * SECONDS_PER_SLOT * 1000);
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const res = await client.getUpdates(0, 1);
    ApiError.assert(res);
    const updates = res.response;
    const slot = bn.chain.clock.currentSlot;
    expect(updates.length).to.be.equal(1);
    // at slot 2 we got attestedHeader for slot 1
    expect(updates[0].data.attestedHeader.beacon.slot).to.be.equal(slot - 1);
    // version is set
    expect(updates[0].version).to.be.equal(ForkName.altair);
  });

  it("getOptimisticUpdate()", async function () {
    await sleep(2 * SECONDS_PER_SLOT * 1000);
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const res = await client.getOptimisticUpdate();
    ApiError.assert(res);
    const update = res.response;
    const slot = bn.chain.clock.currentSlot;
    // at slot 2 we got attestedHeader for slot 1
    expect(update.data.attestedHeader.beacon.slot).to.be.equal(slot - 1);
    // version is set
    expect(update.version).to.be.equal(ForkName.altair);
  });

  it.skip("getFinalityUpdate()", async function () {
    // TODO: not sure how this causes subsequent tests failed
    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, routes.events.EventType.finalizedCheckpoint, 240000);
    await sleep(SECONDS_PER_SLOT * 1000);
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const res = await client.getFinalityUpdate();
    ApiError.assert(res);
    expect(res.response).to.be.not.undefined;
  });

  it("getCommitteeRoot() for the 1st period", async function () {
    // call this right away causes "No partialUpdate available for period 0"
    await sleep(2 * SECONDS_PER_SLOT * 1000);

    const lightclient = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const committeeRes = await lightclient.getCommitteeRoot(0, 1);
    ApiError.assert(committeeRes);
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).beacon;
    const validatorResponse = await client.getStateValidators("head");
    ApiError.assert(validatorResponse);
    const pubkeys = validatorResponse.response.data.map((v) => v.validator.pubkey);
    expect(pubkeys.length).to.be.equal(validatorCount);
    // only 2 validators spreading to 512 committee slots
    const committeePubkeys = Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) =>
      i % 2 === 0 ? pubkeys[0] : pubkeys[1]
    );
    const aggregatePubkey = bls.aggregatePublicKeys(committeePubkeys);
    // single committe hash since we requested for the first period
    expect(committeeRes.response.data).to.be.deep.equal([
      ssz.altair.SyncCommittee.hashTreeRoot({
        pubkeys: committeePubkeys,
        aggregatePubkey,
      }),
    ]);
  });
});
