/* eslint-disable @typescript-eslint/naming-convention */
import {writeFile} from "node:fs/promises";
import path from "node:path";
import got from "got";
import {ZERO_HASH} from "@lodestar/state-transition";
import {SHARED_JWT_SECRET, SIM_ENV_NETWORK_ID} from "../constants.js";
import {Eth1ProviderWithAdmin} from "../Eth1ProviderWithAdmin.js";
import {ELClient, ELClientGenerator, ELStartMode, JobOptions, RunnerType} from "../interfaces.js";
import {getNodeMountedPaths} from "../utils/paths.js";
import {getNodePorts} from "../utils/ports.js";

const SECRET_KEY = "45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8";
const PASSWORD = "12345678";
const GENESIS_ACCOUNT = "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b";

export const generateGethNode: ELClientGenerator<ELClient.Geth> = (opts, runner) => {
  if (!process.env.GETH_BINARY_DIR && !process.env.GETH_DOCKER_IMAGE) {
    throw new Error("GETH_BINARY_DIR or GETH_DOCKER_IMAGE must be provided");
  }

  const {id, mode, ttd, address, mining, clientOptions, nodeIndex} = opts;
  const {
    el: {httpPort, enginePort, port},
  } = getNodePorts(nodeIndex);

  const isDocker = process.env.GETH_DOCKER_IMAGE !== undefined;
  const binaryPath = isDocker ? "" : `${process.env.GETH_BINARY_DIR}/geth`;
  const {rootDir, rootDirMounted, genesisFilePathMounted, logFilePath, jwtsecretFilePathMounted} = getNodeMountedPaths(
    opts.paths,
    "/data",
    isDocker
  );
  const ethRpcUrl = `http://127.0.0.1:${httpPort}`;
  const engineRpcUrl = `http://${address}:${enginePort}`;

  const skPath = path.join(rootDir, "sk.json");
  const skPathMounted = path.join(rootDirMounted, "sk.json");
  const passwordPath = path.join(rootDir, "password.txt");
  const passwordPathMounted = path.join(rootDirMounted, "password.txt");

  const initJobOptions: JobOptions = {
    id: `${id}-init`,
    type: isDocker ? RunnerType.Docker : RunnerType.ChildProcess,
    options: isDocker
      ? {
          image: process.env.GETH_DOCKER_IMAGE as string,
          mounts: [[rootDir, rootDirMounted]],
        }
      : undefined,
    cli: {
      command: binaryPath,
      args: [
        "--datadir",
        rootDirMounted,
        "--networkid",
        String(SIM_ENV_NETWORK_ID as number),
        "init",
        genesisFilePathMounted,
      ],
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
  };

  const importJobOptions: JobOptions = {
    id: `${id}-import`,
    type: isDocker ? RunnerType.Docker : RunnerType.ChildProcess,
    options: isDocker
      ? {
          image: process.env.GETH_DOCKER_IMAGE as string,
          mounts: [[rootDir, rootDirMounted]],
        }
      : undefined,
    bootstrap: async () => {
      await writeFile(skPath, SECRET_KEY);
      await writeFile(passwordPath, PASSWORD);
    },
    cli: {
      command: binaryPath,
      args: [
        "--datadir",
        rootDirMounted,
        "--networkid",
        String(SIM_ENV_NETWORK_ID as number),
        "account",
        "import",
        "--password",
        passwordPathMounted,
        skPathMounted,
      ],
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
  };

  const startJobOptions: JobOptions = {
    id,
    type: isDocker ? RunnerType.Docker : RunnerType.ChildProcess,
    options: isDocker
      ? {
          image: process.env.GETH_DOCKER_IMAGE as string,
          mounts: [[rootDir, rootDirMounted]],
          exposePorts: [enginePort, httpPort, port],
          dockerNetworkIp: address,
        }
      : undefined,
    cli: {
      command: binaryPath,
      args: [
        "--http",
        "--http.api",
        "engine,net,eth,miner,admin",
        "--http.port",
        String(httpPort as number),
        "--http.addr",
        "0.0.0.0",
        "--authrpc.port",
        String(enginePort as number),
        "--authrpc.addr",
        "0.0.0.0",
        "--port",
        String(port as number),
        "--nat",
        `extip:${address}`,
        "--authrpc.jwtsecret",
        jwtsecretFilePathMounted,
        "--datadir",
        rootDirMounted,
        "--allow-insecure-unlock",
        "--unlock",
        GENESIS_ACCOUNT,
        "--password",
        passwordPathMounted,
        "--syncmode",
        "full",
        "--networkid",
        String(SIM_ENV_NETWORK_ID as number),
        // Logging verbosity: 0=silent, 1=error, 2=warn, 3=info, 4=debug, 5=detail
        "--verbosity",
        "5",
        ...(mining ? ["--mine"] : []),
        ...(mode == ELStartMode.PreMerge ? ["--nodiscover"] : []),
        ...clientOptions,
      ],
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
    health: async () => {
      try {
        await got.post(ethRpcUrl, {json: {jsonrpc: "2.0", method: "net_version", params: [], id: 67}});
        return {ok: true};
      } catch (err) {
        return {ok: false, reason: (err as Error).message, checkId: "JSON RPC query net_version"};
      }
    },
  };

  const job = runner.create([{...initJobOptions, children: [{...importJobOptions, children: [startJobOptions]}]}]);

  const provider = new Eth1ProviderWithAdmin(
    {DEPOSIT_CONTRACT_ADDRESS: ZERO_HASH},
    // To allow admin_* RPC methods had to add "ethRpcUrl"
    {providerUrls: [`http://127.0.0.1:${httpPort}`, `http://127.0.0.1:${enginePort}`], jwtSecretHex: SHARED_JWT_SECRET}
  );

  return {
    client: ELClient.Geth,
    id,
    engineRpcUrl,
    ethRpcUrl,
    ttd,
    jwtSecretHex: SHARED_JWT_SECRET,
    provider,
    job,
  };
};
