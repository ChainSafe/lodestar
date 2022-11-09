import {expect} from "chai";
import {createIBeaconConfig, IChainConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {getClient} from "@lodestar/api";
import {toHexString} from "@chainsafe/ssz";
import {LogLevel, testLogger, TestLoggerOpts} from "../../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../../../../utils/node/validator.js";

/* eslint-disable @typescript-eslint/naming-convention */
describe("lodestar / api / impl / state", function () {
  const SECONDS_PER_SLOT = 2;
  const ALTAIR_FORK_EPOCH = 0;
  const restPort = 9596;
  const chainConfig: IChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createIBeaconConfig(chainConfig, genesisValidatorsRoot);
  const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
  const loggerNodeA = testLogger("Node-A", testLoggerOpts);

  describe("eth/v1/beacon/states/{status_id}/validators", function () {
    this.timeout("10 min");
    const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
      SECONDS_PER_SLOT: 2,
    };

    const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
    afterEach(async () => {
      while (afterEachCallbacks.length > 0) {
        const callback = afterEachCallbacks.pop();
        if (callback) await callback();
      }
    });

    it("should return all validators when getStateValidators called without filters", async function () {
      const validatorCount = 2;
      const bn = await getDevBeaconNode({
        params: testParams,
        options: {
          sync: {isSingleNode: true},
          api: {rest: {enabled: true, port: restPort}},
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount,
        logger: loggerNodeA,
      });
      afterEachCallbacks.push(() => bn.close());

      const {validators} = await getAndInitDevValidators({
        node: bn,
        validatorsPerClient: validatorCount,
        validatorClientCount: 1,
        startIndex: 0,
        useRestApi: false,
        testLoggerOpts,
      });
      afterEachCallbacks.push(() => Promise.all(validators.map((validator) => validator.close())));

      const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).beacon;

      const response = await client.getStateValidators("head");
      expect(response.data.length).to.be.equal(validatorCount);
      expect(response.data[0].index).to.be.equal(0);
      expect(response.data[1].index).to.be.equal(1);
    });

    it("should return filtered validators when getStateValidators called with filters", async function () {
      const validatorCount = 2;
      const filterPubKey =
        "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c";

      const bn = await getDevBeaconNode({
        params: testParams,
        options: {
          sync: {isSingleNode: true},
          api: {rest: {enabled: true, port: restPort}},
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount,
        logger: loggerNodeA,
      });
      afterEachCallbacks.push(() => bn.close());

      const {validators} = await getAndInitDevValidators({
        node: bn,
        validatorsPerClient: validatorCount,
        validatorClientCount: 1,
        startIndex: 0,
        useRestApi: false,
        testLoggerOpts,
      });
      afterEachCallbacks.push(() => Promise.all(validators.map((validator) => validator.close())));

      const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).beacon;

      const response = await client.getStateValidators("head", {
        id: [filterPubKey],
      });

      expect(response.data.length).to.be.equal(1);
      expect(toHexString(response.data[0].validator.pubkey)).to.be.equal(filterPubKey);
    });
  });
});
