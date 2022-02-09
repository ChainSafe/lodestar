import {createIBeaconConfig, IChainConfig} from "@chainsafe/lodestar-config";
import {LogLevel, testLogger, TestLoggerOpts} from "../../utils/logger";
import {getDevBeaconNode} from "../../utils/node/beacon";
import {getAndInitDevValidators} from "../../utils/node/validator";
import {KeymanagerApi, KeymanagerServer} from "@chainsafe/lodestar-keymanager-server";
import {chainConfig as chainConfigDef} from "@chainsafe/lodestar-config/default";
import {getKeymanagerClient, HttpClient} from "@chainsafe/lodestar-api/src";

describe("keymanager delete and import test", async function () {
  const validatorCount = 2;
  const SECONDS_PER_SLOT = 2;
  const ALTAIR_FORK_EPOCH = 0;
  const beaconParams: Partial<IChainConfig> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: SECONDS_PER_SLOT,
  };

  let keymanagerServer: KeymanagerServer;

  afterEach(() => {
    void keymanagerServer.close();
  });

  it("should migrate validator from one VC to another", async () => {
    this.timeout("10 min");

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const chainConfig: IChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
    const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
    const config = createIBeaconConfig(chainConfig, genesisValidatorsRoot);

    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {isSingleNode: true}},
      validatorCount,
      logger: loggerNodeA,
    });

    const {validators, secretKeys: _secretKeys, keymanagerOps} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
    });

    if (keymanagerOps) {
      const keymanagerApi = new KeymanagerApi(
        validators[0],
        keymanagerOps[0],
        validators[0].genesis.genesisValidatorsRoot
      );

      keymanagerServer = new KeymanagerServer(
        {host: "127.0.0.1", port: 9667, cors: "*", tokenDir: "."},
        {config, logger: loggerNodeA, api: keymanagerApi}
      );

      await keymanagerServer.listen();

      const client = getKeymanagerClient(config, new HttpClient({baseUrl: "http://127.0.0.1:9667"}));
      const _keys = await client.listKeys();
      //console.log(keys);
    }
  });
});
