import childProcess from "node:child_process";
import {ApiClient, getClient} from "@lodestar/api/keymanager";
import {config} from "@lodestar/config/default";
import {gracefullyStopChildProcess, spawnCliCommand} from "@lodestar/test-utils";
import {retry} from "@lodestar/utils";
import {getMockBeaconApiServer} from "./mockBeaconApiServer.js";
import {expectDeepEqualsUnordered, findApiToken} from "./runUtils.js";

export async function startValidatorWithKeyManager(
  args: string[],
  {
    dataDir,
    logPrefix,
  }: {
    dataDir: string;
    logPrefix?: string;
  }
): Promise<{
  validator: childProcess.ChildProcessWithoutNullStreams;
  stopValidator: () => Promise<void>;
  keymanagerClient: ApiClient;
}> {
  const keymanagerPort = 38011;
  const beaconPort = 39011;
  const keymanagerUrl = `http://localhost:${keymanagerPort}`;
  const beaconUrl = `http://localhost:${beaconPort}`;
  const beaconServer = getMockBeaconApiServer({port: beaconPort});

  await beaconServer.listen();

  const validatorProc = await spawnCliCommand(
    "packages/cli/bin/lodestar.js",
    [
      "validator",
      `--dataDir=${dataDir}`,
      "--keymanager",
      "--keymanager.address=localhost",
      `--keymanager.port=${keymanagerPort}`,
      `--server=${beaconUrl}`,
      ...(args ?? []),
    ],
    {pipeStdioToParent: true, logPrefix: logPrefix ?? "vc"}
  );

  // Exit early if process exits
  validatorProc.on("exit", (code) => {
    if (code !== null && code > 0) {
      throw new Error(`process exited with code ${code}`);
    }
  });

  // Wait for api-token.txt file to be written to disk and find it
  const apiToken = await retry(async () => findApiToken(dataDir), {retryDelay: 500, retries: 10});
  const controller = new AbortController();
  const keymanagerClient = getClient(
    {baseUrl: keymanagerUrl, globalInit: {bearerToken: apiToken, signal: controller.signal}},
    {config}
  );

  // Wrap in retry since the API may not be listening yet
  // Remote key endpoint takes a while to be ready
  await retry(() => keymanagerClient.listRemoteKeys(), {retryDelay: 500, retries: 20});

  validatorProc.addListener("exit", () => {
    controller.abort();
  });

  const stopValidator = async (): Promise<void> => {
    validatorProc.removeAllListeners("exit");
    controller.abort();
    await beaconServer.close();
    await gracefullyStopChildProcess(validatorProc, 3000);
  };

  return {
    validator: validatorProc,
    stopValidator,
    keymanagerClient,
  };
}

/**
 * Query `keymanagerClient.listKeys()` API endpoint and assert that expectedPubkeys are in the response
 */
export async function expectKeys(
  keymanagerClient: ApiClient,
  expectedPubkeys: string[],
  message: string
): Promise<void> {
  const keys = (await keymanagerClient.listKeys()).value();
  // The order of keys isn't always deterministic so we can't use deep equal
  expectDeepEqualsUnordered(
    keys,
    expectedPubkeys.map((pubkey) => ({validatingPubkey: pubkey, derivationPath: "", readonly: false})),
    message
  );
}
