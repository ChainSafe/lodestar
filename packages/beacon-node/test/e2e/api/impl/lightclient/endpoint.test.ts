import {expect} from "chai";
import {createIBeaconConfig, IChainConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {getClient} from "@lodestar/api";
import {sleep} from "@lodestar/utils";
import {SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {digest} from "@chainsafe/as-sha256";
import {Validator} from "@lodestar/validator";
import {phase0} from "@lodestar/types";
import {LogLevel, testLogger, TestLoggerOpts} from "../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../../../utils/node/validator.js";
import {BeaconNode} from "../../../../../src/node/nodejs.js";
import {waitForEvent} from "../../../../utils/events/resolver.js";
import {ChainEvent} from "../../../../../src/chain/emitter.js";

/* eslint-disable @typescript-eslint/naming-convention */
describe("lightclient api", function () {
  this.timeout("10 min");

  const SECONDS_PER_SLOT = 1;
  const ALTAIR_FORK_EPOCH = 0;
  const restPort = 9596;
  const chainConfig: IChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createIBeaconConfig(chainConfig, genesisValidatorsRoot);
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
    const {data: updates} = await client.getUpdates(0, 1);
    const slot = bn.chain.clock.currentSlot;
    expect(updates.length).to.be.equal(1);
    // at slot 2 we got attestedHeader for slot 1
    expect(updates[0].attestedHeader.slot).to.be.equal(slot - 1);
  });

  it("getOptimisticUpdate()", async function () {
    await sleep(2 * SECONDS_PER_SLOT * 1000);
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const {data: update} = await client.getOptimisticUpdate();
    const slot = bn.chain.clock.currentSlot;
    // at slot 2 we got attestedHeader for slot 1
    expect(update.attestedHeader.slot).to.be.equal(slot - 1);
  });

  it.skip("getFinalityUpdate()", async function () {
    // TODO: not sure how this causes subsequent tests failed
    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.finalized, 240000);
    await sleep(SECONDS_PER_SLOT * 1000);
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const {data: update} = await client.getFinalityUpdate();
    expect(update).to.be.not.undefined;
  });

  it("getCommitteeHash() for the 1st period", async function () {
    // call this right away causes "No partialUpdate available for period 0"
    await sleep(2 * SECONDS_PER_SLOT * 1000);

    const lightclient = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).lightclient;
    const {data: syncCommitteeHash} = await lightclient.getCommitteeHash(0, 1);
    const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).beacon;
    const {data: validatorResponses} = await client.getStateValidators("head");
    const pubkeys = validatorResponses.map((v) => v.validator.pubkey);
    expect(pubkeys.length).to.be.equal(validatorCount);
    // only 2 validators spreading to 512 committee slots
    const syncCommittee = Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => (i % 2 === 0 ? pubkeys[0] : pubkeys[1]));
    // single committe hash since we requested for the first period
    expect(syncCommitteeHash).to.be.deep.equal([digest(Buffer.concat(syncCommittee))]);
  });
});
