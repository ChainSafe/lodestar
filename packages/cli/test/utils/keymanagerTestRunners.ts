import {sleep, retry} from "@lodestar/utils";
import {Api, getClient} from "@lodestar/api/keymanager";
import {config} from "@lodestar/config/default";
import {getMockBeaconApiServer} from "./mockBeaconApiServer.js";
import {AfterEachCallback, expectDeepEquals, findApiToken, itDone} from "./runUtils.js";
import {DescribeArgs} from "./childprocRunner.js";

type TestContext = {
  args: DescribeArgs;
  afterEachCallbacks: AfterEachCallback[];
  dataDir: string;
};

type KeymanagerStepOpts = {
  validatorCmdExtraArgs?: string[];
};

type KeymanagerStepCbArgs = {
  keymanagerUrl: string;
};

export function getKeymanagerTestRunner({args: {spawnCli}, afterEachCallbacks, dataDir}: TestContext) {
  return function itKeymanagerStep(
    itName: string,
    cb: (this: Mocha.Context, keymanagerClient: Api, args: KeymanagerStepCbArgs) => Promise<void>,
    keymanagerStepOpts?: KeymanagerStepOpts
  ): void {
    itDone(itName, async function (done) {
      this.timeout("60s");

      const keymanagerPort = 38011;
      const beaconPort = 39011;
      const keymanagerUrl = `http://localhost:${keymanagerPort}`;
      const beaconUrl = `http://localhost:${beaconPort}`;

      const beaconServer = getMockBeaconApiServer({port: beaconPort});
      afterEachCallbacks.push(() => beaconServer.close());
      await beaconServer.listen();

      const validatorProc = spawnCli({pipeStdToParent: true, logPrefix: "vc"}, [
        // ⏎
        "validator",
        `--dataDir=${dataDir}`,
        "--keymanager",
        "--keymanager.address=localhost",
        `--keymanager.port=${keymanagerPort}`,
        `--server=${beaconUrl}`,
        ...(keymanagerStepOpts?.validatorCmdExtraArgs ?? []),
      ]);
      // Exit early if process exits
      validatorProc.on("exit", (code) => {
        if (code !== null && code > 0) {
          done(Error(`process exited with code ${code}`));
        }
      });

      // Wait for api-token.txt file to be written to disk and find it
      const apiToken = await retry(async () => findApiToken(dataDir), {retryDelay: 500, retries: 10});

      const keymanagerClient = getClient({baseUrl: keymanagerUrl, bearerToken: apiToken}, {config});

      // Wrap in retry since the API may not be listening yet
      await retry(() => keymanagerClient.listRemoteKeys(), {retryDelay: 500, retries: 10});

      await cb.bind(this)(keymanagerClient, {keymanagerUrl});

      validatorProc.kill("SIGINT");
      await sleep(1000);
      validatorProc.kill("SIGKILL");
    });
  };
}

/**
 * Query `keymanagerClient.listKeys()` API endpoint and assert that expectedPubkeys are in the response
 */
export async function expectKeys(keymanagerClient: Api, expectedPubkeys: string[], message: string): Promise<void> {
  const keys = await keymanagerClient.listKeys();
  expectDeepEquals(
    keys.data,
    expectedPubkeys.map((pubkey) => ({validatingPubkey: pubkey, derivationPath: "", readonly: false})),
    message
  );
}
