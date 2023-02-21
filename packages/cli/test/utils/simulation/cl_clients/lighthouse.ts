/* eslint-disable @typescript-eslint/naming-convention */
import {mkdir, writeFile, cp} from "node:fs/promises";
import {dirname, join} from "node:path";
import got from "got";
import {RequestError} from "got";
import yaml from "js-yaml";
import {Keystore} from "@chainsafe/bls-keystore";
import {getClient} from "@lodestar/api/beacon";
import {getClient as keyManagerGetClient} from "@lodestar/api/keymanager";
import {chainConfigToJson} from "@lodestar/config";
import {HttpClient} from "@lodestar/api";
import {
  CLClient,
  CLClientGenerator,
  CLClientGeneratorOptions,
  IRunner,
  JobOptions,
  LighthouseAPI,
  RunnerType,
} from "../interfaces.js";

export const generateLighthouseBeaconNode: CLClientGenerator<CLClient.Lighthouse> = (opts, runner) => {
  if (!process.env.LIGHTHOUSE_BINARY_PATH && !process.env.LIGHTHOUSE_DOCKER_IMAGE) {
    throw new Error("LIGHTHOUSE_BINARY_PATH or LIGHTHOUSE_DOCKER_IMAGE must be provided");
  }

  const isDocker = process.env.LIGHTHOUSE_DOCKER_IMAGE !== undefined;

  const {dataDir, address, restPort, port, id, config, keys, keyManagerPort} = opts;
  const {engineUrls, genesisStateFilePath, jwtSecretHex, engineMock, clientOptions} = opts;

  const dataDirParam = isDocker ? "/data" : dataDir;
  const jwtSecretPath = join(dataDir, "jwtsecret.txt");

  const cliParams: Record<string, unknown> = {
    "testnet-dir": dataDirParam,
    datadir: dataDirParam,
    http: null,
    //  Enable the RESTful HTTP API server. Disabled by default.
    // Forces the HTTP to indicate that the node is synced when sync is actually
    // stalled. This is useful for very small testnets. TESTING ONLY. DO NOT USE ON MAINNET.
    "http-allow-sync-stalled": null,
    "http-address": "0.0.0.0",
    "http-port": restPort,
    "http-allow-origin": "*",
    "listen-address": "0.0.0.0",
    port: port,
    "enr-address": address,
    "enr-udp-port": port,
    "enr-tcp-port": port,
    "disable-discovery": null,
    "enable-private-discovery": null,
    "debug-level": "debug",
    ...clientOptions,
  };

  if (engineMock) {
    cliParams["dummy-eth1"] = null;
  } else {
    cliParams["execution-jwt"] = join(dataDirParam, "jwtsecret.txt");
    cliParams["execution-endpoint"] = [...engineUrls].join(",");
  }

  const beaconNodeJob: JobOptions = {
    id,
    type: isDocker ? RunnerType.Docker : RunnerType.ChildProcess,
    options: isDocker
      ? {
          image: process.env.LIGHTHOUSE_DOCKER_IMAGE as string,
          dataVolumePath: dataDir,
          exposePorts: [restPort, port],
          dockerNetworkIp: address,
        }
      : undefined,
    bootstrap: async () => {
      await mkdir(dataDir, {recursive: true});
      await writeFile(jwtSecretPath, jwtSecretHex);
      await writeFile(join(dataDir, "config.yaml"), yaml.dump(chainConfigToJson(config)));
      // await writeFile(join(dataDir, "boot_enr.yaml"), "[]");
      await writeFile(join(dataDir, "deploy_block.txt"), "0");
      await cp(genesisStateFilePath, join(dataDir, "genesis.ssz"));
    },
    cli: {
      command: isDocker ? "lighthouse" : (process.env.LIGHTHOUSE_BINARY_PATH as string),
      args: [
        "beacon_node",
        ...Object.entries(cliParams).flatMap(([key, value]) =>
          value === null ? [`--${key}`] : [`--${key}`, String(value)]
        ),
      ],
      env: {},
    },
    logs: {
      stdoutFilePath: opts.logFilePath,
    },
    health: async () => {
      try {
        await got.get(`http://127.0.0.1:${restPort}/eth/v1/node/health`);
        return {ok: true};
      } catch (err) {
        if (err instanceof RequestError && err.code !== "ECONNREFUSED") {
          return {ok: true};
        }
        return {ok: false, reason: (err as Error).message, checkId: "/eth/v1/node/health query"};
      }
    },
  };

  const validatorClientsJobs: JobOptions[] = [];
  if (keys.type !== "no-keys") {
    validatorClientsJobs.push(
      generateLighthouseValidatorJobs(
        {
          ...opts,
          dataDir,
          id: `${id}-validator`,
          logFilePath: join(dirname(opts.logFilePath), `${id}-validator.log`),
        },
        runner
      )
    );
  }

  const httpClient = new HttpClient({baseUrl: `http://127.0.0.1:${restPort}`});
  const api = (getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}) as unknown) as LighthouseAPI;
  api.lighthouse = {
    async getPeers() {
      return httpClient.json({url: "/lighthouse/peers", method: "GET"});
    },
  };

  return {
    id,
    client: CLClient.Lighthouse,
    url: `http://127.0.0.1:${restPort}`,
    keys,
    api,
    keyManager: keyManagerGetClient({baseUrl: `http://127.0.0.1:${keyManagerPort}`}, {config}),
    job: runner.create([{...beaconNodeJob, children: [...validatorClientsJobs]}]),
  };
};

export const generateLighthouseValidatorJobs = (opts: CLClientGeneratorOptions, runner: IRunner): JobOptions => {
  const isDocker = process.env.LIGHTHOUSE_DOCKER_IMAGE !== undefined;

  const binaryPath = isDocker ? "lighthouse" : `${process.env.LIGHTHOUSE_BINARY_PATH}`;
  const {dataDir, id, address, keyManagerPort, restPort, keys} = opts;
  const dataDirParam = isDocker ? "/data" : dataDir;

  if (keys.type === "no-keys") {
    throw Error("Attempting to run a vc with keys.type == 'no-keys'");
  }

  const params = {
    "testnet-dir": dataDirParam,
    "beacon-nodes": `http://${address}:${restPort}/`,
    "debug-level": "debug",
    "init-slashing-protection": null,
    "allow-unsynced": null,
    http: null,
    "unencrypted-http-transport": null,
    "http-address": "0.0.0.0",
    "http-port": keyManagerPort,
    "validators-dir": join(dataDirParam, "validators"),
  };

  return {
    id,
    type: isDocker ? RunnerType.Docker : RunnerType.ChildProcess,
    options: isDocker
      ? {
          image: process.env.LIGHTHOUSE_DOCKER_IMAGE as string,
          dataVolumePath: dataDir,
          dockerNetworkIp: runner.getNextIp(),
        }
      : undefined,
    bootstrap: async () => {
      await mkdir(join(dataDir, "validators"));
      await writeFile(join(dataDir, "password.txt"), "password");

      if (keys.type === "local") {
        const definition = [];

        for (const key of keys.secretKeys) {
          const keystore = await Keystore.create("password", key.toBytes(), key.toPublicKey().toBytes(), "");
          await writeFile(
            join(dataDir, "validators", `${key.toPublicKey().toHex()}.json`),
            JSON.stringify(keystore.toObject(), null, 2)
          );

          definition.push({
            enabled: true,
            type: "local_keystore",
            voting_public_key: key.toPublicKey().toHex(),
            voting_keystore_path: join(dataDirParam, "validators", `${key.toPublicKey().toHex()}.json`),
            voting_keystore_password_path: join(dataDirParam, "password.txt"),
          });
        }

        await writeFile(
          join(dataDir, "validators", "validator_definitions.yml"),
          yaml.dump(definition, {
            styles: {
              "!!null": "canonical", // dump null as ~
            },
            sortKeys: true, // sort object keys
          })
        );
      }
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
      stdoutFilePath: opts.logFilePath,
    },
    health: async () => {
      try {
        await got.get(`http://127.0.0.1:${keyManagerPort}/lighthouse/health`);
        return {ok: true};
      } catch (err) {
        if (err instanceof RequestError) {
          return {ok: true};
        }
        return {ok: false, reason: (err as Error).message, checkId: "/lighthouse/health query"};
      }
    },
  };
};
