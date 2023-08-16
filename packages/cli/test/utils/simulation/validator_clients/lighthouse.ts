/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {writeFile} from "node:fs/promises";
import got, {RequestError} from "got";
import yaml from "js-yaml";
import {getClient as keyManagerGetClient} from "@lodestar/api/keymanager";
import {chainConfigToJson} from "@lodestar/config";
import {RunnerType, ValidatorClient, ValidatorNodeGenerator} from "../interfaces.js";
import {updateKeystoresPath} from "../utils/keys.js";
import {getNodeMountedPaths} from "../utils/paths.js";
import {getNodePorts} from "../utils/ports.js";

export const generateLighthouseValidatorNode: ValidatorNodeGenerator<ValidatorClient.Lighthouse> = (opts, runner) => {
  if (!process.env.LIGHTHOUSE_BINARY_PATH && !process.env.LIGHTHOUSE_DOCKER_IMAGE) {
    throw new Error("LIGHTHOUSE_BINARY_PATH or LIGHTHOUSE_DOCKER_IMAGE must be provided");
  }

  const isDocker = process.env.LIGHTHOUSE_DOCKER_IMAGE !== undefined;
  const binaryPath = isDocker ? "lighthouse" : `${process.env.LIGHTHOUSE_BINARY_PATH}`;

  const {id, forkConfig, keys, beaconUrls} = opts;

  const {
    rootDir,
    rootDirMounted,
    logFilePath,
    validatorsDirMounted,
    validatorsDefinitionFilePath,
    validatorsDefinitionFilePathMounted,
  } = getNodeMountedPaths(opts.paths, "/data", isDocker);
  const ports = getNodePorts(opts.nodeIndex);

  if (keys.type === "no-keys") {
    throw Error("Attempting to run a vc with keys.type == 'no-keys'");
  }

  const params = {
    "testnet-dir": rootDirMounted,
    "beacon-nodes": beaconUrls[0],
    "debug-level": "debug",
    "init-slashing-protection": null,
    "allow-unsynced": null,
    http: null,
    "unencrypted-http-transport": null,
    "http-address": "0.0.0.0",
    "http-port": ports.validator.keymanagerPort,
    "validators-dir": validatorsDirMounted,
  };

  const job = runner.create([
    {
      id,
      type: isDocker ? RunnerType.Docker : RunnerType.ChildProcess,
      options: isDocker
        ? {
            image: process.env.LIGHTHOUSE_DOCKER_IMAGE as string,
            mounts: [[rootDir, rootDirMounted]],
            dockerNetworkIp: runner.getNextIp(),
          }
        : undefined,
      bootstrap: async () => {
        if (isDocker) {
          await updateKeystoresPath(
            validatorsDefinitionFilePath,
            path.dirname(validatorsDefinitionFilePathMounted),
            validatorsDefinitionFilePath
          );
        }
        await writeFile(path.join(rootDir, "config.yaml"), yaml.dump(chainConfigToJson(forkConfig)));
        await writeFile(path.join(rootDir, "deploy_block.txt"), "0");
      },
      cli: {
        command: binaryPath,
        args: [
          "validator_client",
          ...Object.entries(params).flatMap(([key, value]) =>
            value === null ? [`--${key}`] : [`--${key}`, String(value)]
          ),
        ],
        env: {},
      },
      logs: {
        stdoutFilePath: logFilePath,
      },
      health: async () => {
        try {
          await got.get(`http://127.0.0.1:${ports.validator.keymanagerPort}/lighthouse/health`);
          return {ok: true};
        } catch (err) {
          if (err instanceof RequestError) {
            return {ok: true};
          }
          return {ok: false, reason: (err as Error).message, checkId: "/lighthouse/health query"};
        }
      },
    },
  ]);

  return {
    id,
    client: ValidatorClient.Lighthouse,
    keys,
    keyManager: keyManagerGetClient(
      {baseUrl: `http://127.0.0.1:${ports.validator.keymanagerPort}`},
      {config: forkConfig}
    ),
    job,
  };
};
