import {writeFile} from "node:fs/promises";
import path from "node:path";
import got from "got";
import {getClient as keyManagerGetClient} from "@lodestar/api/keymanager";
import {chainConfigToJson} from "@lodestar/config";
import {LogLevel} from "@lodestar/utils";
import {defaultOptions} from "@lodestar/validator";
import {IValidatorCliArgs} from "../../../../../src/cmds/validator/options.js";
import {GlobalArgs} from "../../../../../src/options/globalOptions.js";
import {LODESTAR_BINARY_PATH} from "../../constants.js";
import {RunnerType, ValidatorClient, ValidatorNodeGenerator} from "../../interfaces.js";
import {getNodePorts} from "../../utils/ports.js";

export const generateLodestarValidatorNode: ValidatorNodeGenerator<ValidatorClient.Lodestar> = (opts, runner) => {
  const {paths, id, keys, forkConfig, genesisTime, nodeIndex, beaconUrls, clientOptions} = opts;
  const {rootDir, keystoresDir, keystoresSecretFilePath, logFilePath} = paths;
  const {useProduceBlockV3, "builder.selection": builderSelection, blindedLocal} = clientOptions ?? {};
  const ports = getNodePorts(nodeIndex);
  const rcConfigPath = path.join(rootDir, "rc_config.json");
  const paramsPath = path.join(rootDir, "params.json");

  if (keys.type === "no-keys") {
    throw Error("Attempting to run a vc with keys.type == 'no-keys'");
  }

  const rcConfig = {
    network: "dev",
    preset: "minimal",
    dataDir: rootDir,
    server: beaconUrls,
    keymanager: true,
    "keymanager.auth": false,
    "keymanager.address": "127.0.0.1",
    "keymanager.port": ports.validator.keymanagerPort,
    logPrefix: id,
    logFormatGenesisTime: `${genesisTime}`,
    logLevel: LogLevel.debug,
    logFile: "none",
    importKeystores: keystoresDir,
    importKeystoresPassword: keystoresSecretFilePath,
    useProduceBlockV3: useProduceBlockV3 ?? false,
    "builder.selection": builderSelection ?? defaultOptions.builderSelection,
    blindedLocal: blindedLocal ?? defaultOptions.blindedLocal,
  } as unknown as IValidatorCliArgs & GlobalArgs;

  const job = runner.create([
    {
      id,
      type: RunnerType.ChildProcess,
      bootstrap: async () => {
        await writeFile(rcConfigPath, JSON.stringify(rcConfig, null, 2));
        await writeFile(paramsPath, JSON.stringify(chainConfigToJson(forkConfig), null, 2));
      },
      cli: {
        command: LODESTAR_BINARY_PATH,
        args: [
          "validator",
          "--rcConfig",
          path.join(rootDir, "rc_config.json"),
          "--paramsFile",
          path.join(rootDir, "params.json"),
        ],
        env: {
          DEBUG: process.env.DISABLE_DEBUG_LOGS ? "" : "*,-winston:*",
        },
      },
      logs: {
        stdoutFilePath: logFilePath,
      },
      health: async () => {
        await got.get(`http://127.0.0.1:${ports.validator.keymanagerPort}/eth/v1/keystores`);
      },
    },
  ]);

  return {
    id,
    client: ValidatorClient.Lodestar,
    keys,
    keyManager: keyManagerGetClient(
      {baseUrl: `http://127.0.0.1:${ports.validator.keymanagerPort}`},
      {config: forkConfig}
    ),
    job,
  };
};
