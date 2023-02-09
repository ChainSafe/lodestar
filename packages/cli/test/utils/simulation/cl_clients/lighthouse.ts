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
import {CLClient, CLClientGenerator, CLClientGeneratorOptions, JobOptions, Runner, RunnerType} from "../interfaces.js";
import {isChildProcessRunner} from "../runner/index.js";

export const LIGHTHOUSE_BINARY_PATH = "/Users/nazar/.asdf/installs/rust/1.65.0/bin/lighthouse";

export const generateLighthouseBeaconNode: CLClientGenerator<CLClient.Lighthouse> = (opts, runner) => {
  if (!isChildProcessRunner(runner)) {
    throw new Error(`Runner "${runner.type}" not yet supported.`);
  }
  const {
    dataDir,
    address,
    restPort,
    port,
    id,
    config,
    keys,
    keyManagerPort,
    engineUrls,
    genesisStateFilePath,
    jwtSecretHex,
    engineMock,
    clientOptions,
  } = opts;

  const jwtSecretPath = join(dataDir, "jwtsecret.txt");

  const cliParams: Record<string, unknown> = {
    // network: "mainnet",
    "testnet-dir": dataDir,
    datadir: dataDir,
    // genesisStateFile: genesisStateFilePath,
    // rest: true,
    // "rest.namespace": "*",
    http: null,
    //  Enable the RESTful HTTP API server. Disabled by default.
    // Forces the HTTP to indicate that the node is synced when sync is actually
    // stalled. This is useful for very small testnets. TESTING ONLY. DO NOT USE ON MAINNET.
    "http-allow-sync-stalled": null,
    "http-address": address,
    "http-port": restPort,
    "http-allow-origin": "*",
    // "sync.isSingleNode": false,
    // "network.allowPublishToZeroPeers": false,
    // discv5: true,
    // "network.connectToDiscv5Bootnodes": true,
    "listen-address": address,
    port: port,
    // metrics: false,
    // "boot-nodes": "",
    // "enable-private-discovery": "",
    "enr-address": address,
    "enr-udp-port": port,
    "enr-tcp-port": port,
    "disable-discovery": null,
    "enable-private-discovery": null,
    // logPrefix: id,
    // logFormatGenesisTime: `${genesisTime}`,
    "debug-level": "trace",
    // logFileDailyRotate: 0,
    // logFile: "none",
    // paramsFile: paramsPath,
    ...clientOptions,
  };

  if (engineMock) {
    cliParams["dummy-eth1"] = null;
  } else {
    cliParams["execution-jwt"] = jwtSecretPath;
    cliParams["execution-endpoint"] = [...engineUrls].join(",");
  }

  const validatorClientsJobs: JobOptions[] = [];
  if (keys.type !== "no-keys") {
    validatorClientsJobs.push(
      generateLighthouseValidatorJobs(
        {
          ...opts,
          dataDir: join(dataDir, "validator"),
          id: `${id}-validator`,
          logFilePath: join(dirname(opts.logFilePath), `${id}-validator.log`),
        },
        runner
      )
    );
  }

  const job = runner.create(id, [
    {
      id,
      bootstrap: async () => {
        await mkdir(dataDir, {recursive: true});
        await writeFile(jwtSecretPath, jwtSecretHex);
        await writeFile(join(dataDir, "config.yaml"), yaml.dump(chainConfigToJson(config)));
        // await writeFile(join(dataDir, "boot_enr.yaml"), "[]");
        await writeFile(join(dataDir, "deploy_block.txt"), "0");
        await cp(genesisStateFilePath, join(dataDir, "genesis.ssz"));
      },
      cli: {
        command: LIGHTHOUSE_BINARY_PATH,
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
          await got.get(`http://${address}:${restPort}/eth/v1/node/health`);
          return {ok: true};
        } catch (err) {
          if (err instanceof RequestError && err.code !== "ECONNREFUSED") {
            return {ok: true};
          }
          return {ok: false, reason: (err as Error).message, checkId: "/eth/v1/node/health query"};
        }
      },
      children: validatorClientsJobs,
    },
  ]);

  return {
    id,
    client: CLClient.Lighthouse,
    url: `http://${address}:${restPort}`,
    keys,
    api: getClient({baseUrl: `http://${address}:${restPort}`}, {config}),
    keyManager: keyManagerGetClient({baseUrl: `http://${address}:${keyManagerPort}`}, {config}),
    job,
  };
};

export const generateLighthouseValidatorJobs = (
  opts: CLClientGeneratorOptions,
  runner: Runner<RunnerType.ChildProcess> | Runner<RunnerType.Docker>
): JobOptions => {
  if (runner.type !== RunnerType.ChildProcess) {
    throw new Error(`Runner "${runner.type}" not yet supported.`);
  }

  const {dataDir, id, address, keyManagerPort, restPort, keys} = opts;

  if (keys.type === "no-keys") {
    throw Error("Attempting to run a vc with keys.type == 'no-keys'");
  }

  const params = {
    // network: "mainnet",
    spec: "minimal",
    "testnet-dir": join(dataDir, "../"),
    datadir: dataDir,
    "beacon-nodes": `http://${address}:${restPort}/`,
    "debug-level": "debug",
    "init-slashing-protection": null,
    "allow-unsynced": null,
    http: null,
    "unencrypted-http-transport": null,
    "http-address": address,
    "http-port": keyManagerPort,
    // keymanager: true,
    // "keymanager.authEnabled": false,
    // "keymanager.address": address,
    // "keymanager.port": keyManagerPort,
    // "validators-dir": `${dataDir}/validators`,
  };

  return {
    id,
    bootstrap: async () => {
      await mkdir(dataDir);
      await mkdir(`${dataDir}/validators`);
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
            voting_keystore_path: join(dataDir, "validators", `${key.toPublicKey().toHex()}.json`),
            voting_keystore_password_path: join(dataDir, "password.txt"),
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
      command: LIGHTHOUSE_BINARY_PATH,
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
        await got.get(`http://${address}:${keyManagerPort}/lighthouse/health`);
        return {ok: true};
      } catch (err) {
        if (err instanceof RequestError) {
          console.log(err.response?.body);
          return {ok: true};
        }
        return {ok: false, reason: (err as Error).message, checkId: "/lighthouse/health query"};
      }
    },
  };
};
