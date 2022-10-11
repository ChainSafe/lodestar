import {expect} from "chai";
import {createIBeaconConfig, IChainConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {getClient} from "@lodestar/api";
import {ListCompositeType, toHexString} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {LogLevel, testLogger, TestLoggerOpts} from "../../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../../utils/node/beacon.js";

/* eslint-disable @typescript-eslint/naming-convention */
describe("lodestar / api / impl / light_client", function () {
  const SECONDS_PER_SLOT = 2;
  const ALTAIR_FORK_EPOCH = 0;
  const restPort = 9596;
  const chainConfig: IChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createIBeaconConfig(chainConfig, genesisValidatorsRoot);
  const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
  const loggerNodeA = testLogger("Node-A", testLoggerOpts);

  describe("eth/v1/beacon/light_client/bootstrap/{block_root}", function () {
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

    it("should return bootstrap as ssz and json", async function () {
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

      const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config});
      const expectedValue = ssz.altair.LightClientBootstrap.defaultValue();

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      bn.chain.lightClientServer.getBootstrap = (blockRoot: Uint8Array) => {
        return Promise.resolve(expectedValue);
      };

      const responseSSZ = await client.lightclient.getBootstrap(toHexString(Buffer.alloc(0)), "ssz");
      expect(responseSSZ).to.be.deep.equal(
        ssz.altair.LightClientBootstrap.serialize(expectedValue),
        "Returned Bootstrap in SSZ invalid"
      );

      const responseJSON = await client.lightclient.getBootstrap(toHexString(Buffer.alloc(0)), "json");
      expect(responseJSON.data).to.be.deep.equal(expectedValue, "Returned Bootstrap in JSON invalid");
    });

    it("should return Finality Update as ssz and json", async function () {
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

      const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config});
      const expectedValue = ssz.altair.LightClientFinalityUpdate.defaultValue();

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      bn.chain.lightClientServer.getFinalityUpdate = () => {
        return expectedValue;
      };

      const responseSSZ = await client.lightclient.getFinalityUpdate("ssz");
      expect(responseSSZ).to.be.deep.equal(
        ssz.altair.LightClientFinalityUpdate.serialize(expectedValue),
        "Returned FinalityUpdate in SSZ invalid"
      );

      const responseJSON = await client.lightclient.getFinalityUpdate("json");
      expect(responseJSON.data).to.be.deep.equal(expectedValue, "Returned FinalityUpdate in JSON invalid");
    });

    it("should return Optimistic Update as ssz and json", async function () {
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

      const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config});
      const expectedValue = ssz.altair.LightClientOptimisticUpdate.defaultValue();

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      bn.chain.lightClientServer.getOptimisticUpdate = () => {
        return expectedValue;
      };

      const responseSSZ = await client.lightclient.getOptimisticUpdate("ssz");
      expect(responseSSZ).to.be.deep.equal(
        ssz.altair.LightClientOptimisticUpdate.serialize(expectedValue),
        "Returned OptimisticUpdate in SSZ invalid"
      );

      const responseJSON = await client.lightclient.getOptimisticUpdate("json");
      expect(responseJSON.data).to.be.deep.equal(expectedValue, "Returned OptimisticUpdate in JSON invalid");
    });

    it("should return Update as ssz and json", async function () {
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

      const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config});
      const firstLcUpdate = ssz.altair.LightClientUpdate.defaultValue();
      firstLcUpdate.signatureSlot = 0;
      const secondLcUpdate = ssz.altair.LightClientUpdate.defaultValue();
      secondLcUpdate.signatureSlot = 1;
      const expectedResponse = [firstLcUpdate, secondLcUpdate];

      const lightClientUpdateCodec = new ListCompositeType(ssz.altair.LightClientUpdate, expectedResponse.length);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      bn.chain.lightClientServer.getUpdates = (syncPeriod, count) => {
        return Promise.resolve(expectedResponse);
      };

      const responseSSZ = await client.lightclient.getUpdates(1, 2, "ssz");
      const resultDeserialized = lightClientUpdateCodec.deserialize(responseSSZ);

      expect(resultDeserialized.length).to.be.equals(expectedResponse.length, "Length of response invalid");
      expect(
        ssz.altair.LightClientUpdate.equals(expectedResponse[0], resultDeserialized[0]),
        "First LightClientUpdate is invalid"
      ).to.be.true;
      expect(
        ssz.altair.LightClientUpdate.equals(expectedResponse[1], resultDeserialized[1]),
        "Second LightClientUpdate is invalid"
      ).to.be.true;

      const responseJSON = await client.lightclient.getUpdates(1, 2, "json");
      expect(responseJSON.data).to.be.deep.equal([firstLcUpdate, secondLcUpdate], "Returned Updates in JSON invalid");
    });
  });
});
