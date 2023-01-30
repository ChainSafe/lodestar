/* eslint-disable @typescript-eslint/naming-convention */
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import got from "got";
import {ZERO_HASH} from "@lodestar/state-transition";
import {
  ELClient,
  ELClientGenerator,
  ELGeneratorClientOptions,
  ELStartMode,
  JobOptions,
  Runner,
  RunnerType,
} from "../interfaces.js";
import {Eth1ProviderWithAdmin} from "../Eth1ProviderWithAdmin.js";
import {isChildProcessRunner, isDockerRunner} from "../runner/index.js";
import {getGethGenesisBlock} from "../utils/el_genesis.js";
import {SIM_ENV_NETWORK_ID} from "../constants.js";

const SECRET_KEY = "45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8";
const PASSWORD = "12345678";
const GENESIS_ACCOUNT = "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b";

export const generateGethNode: ELClientGenerator<ELClient.Geth> = (
  {
    id,
    mode,
    dataDir,
    ethPort,
    port,
    enginePort,
    ttd,
    logFilePath,
    jwtSecretHex,
    cliqueSealingPeriod,
    address,
    mining,
    clientOptions,
  }: ELGeneratorClientOptions,
  runner: Runner<RunnerType.ChildProcess> | Runner<RunnerType.Docker>
) => {
  if (isChildProcessRunner(runner)) {
    if (!process.env.GETH_BINARY_DIR) {
      throw Error(`EL ENV must be provided, GETH_BINARY_DIR: ${process.env.GETH_BINARY_DIR}`);
    }
  }

  if (isDockerRunner(runner)) {
    if (!process.env.GETH_DOCKER_IMAGE) {
      throw Error(`EL ENV must be provided, GETH_DOCKER_IMAGE: ${process.env.GETH_DOCKER_IMAGE}`);
    }
  }

  const binaryPath = isChildProcessRunner(runner) ? `${process.env.GETH_BINARY_DIR}/geth` : "";
  const gethDataDir = isChildProcessRunner(runner) ? dataDir : "/data";
  const ethRpcUrl = `http://127.0.0.1:${ethPort}`;
  const engineRpcUrl = `http://127.0.0.1:${enginePort}`;

  const skPath = join(dataDir, "sk.json");
  const skGethPath = join(gethDataDir, "sk.json");
  const genesisPath = join(dataDir, "genesis.json");
  const genesisGethPath = join(gethDataDir, "genesis.json");
  const passwordPath = join(dataDir, "password.txt");
  const passwordGethPath = join(gethDataDir, "password.txt");
  const jwtSecretPath = join(dataDir, "jwtsecret");
  const jwtSecretGethPath = join(gethDataDir, "jwtsecret");

  const initJobOptions: JobOptions = {
    id: `${id}-init`,
    bootstrap: async () => {
      await mkdir(dataDir, {recursive: true});
      await writeFile(
        genesisPath,
        JSON.stringify(getGethGenesisBlock(mode, {ttd, cliqueSealingPeriod, clientOptions: []}))
      );
    },
    cli: {
      command: binaryPath,
      args: ["--datadir", gethDataDir, "--networkid", String(SIM_ENV_NETWORK_ID as number), "init", genesisGethPath],
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
  };

  const importJobOptions: JobOptions = {
    id: `${id}-import`,
    bootstrap: async () => {
      await writeFile(skPath, SECRET_KEY);
      await writeFile(passwordPath, PASSWORD);
      await writeFile(jwtSecretPath, jwtSecretHex);
    },
    cli: {
      command: binaryPath,
      args: [
        "--datadir",
        gethDataDir,
        "--networkid",
        String(SIM_ENV_NETWORK_ID as number),
        "account",
        "import",
        "--password",
        passwordGethPath,
        skGethPath,
      ],
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
  };

  const startJobOptions: JobOptions = {
    id,
    cli: {
      command: binaryPath,
      args: [
        "--http",
        "--http.api",
        "engine,net,eth,miner,admin",
        "--http.port",
        String(ethPort as number),
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
        jwtSecretGethPath,
        "--datadir",
        gethDataDir,
        "--allow-insecure-unlock",
        "--unlock",
        GENESIS_ACCOUNT,
        "--password",
        passwordGethPath,
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

  const job = isChildProcessRunner(runner)
    ? runner.create(id, [{...initJobOptions, children: [{...importJobOptions, children: [startJobOptions]}]}])
    : runner.create(id, [{...initJobOptions, children: [{...importJobOptions, children: [startJobOptions]}]}], {
        image: process.env.GETH_DOCKER_IMAGE as string,
        dataVolumePath: dataDir,
        exposePorts: [enginePort, ethPort, port],
        dockerNetworkIp: address,
      });

  const provider = new Eth1ProviderWithAdmin(
    {DEPOSIT_CONTRACT_ADDRESS: ZERO_HASH},
    // To allow admin_* RPC methods had to add "ethRpcUrl"
    {providerUrls: [ethRpcUrl, engineRpcUrl], jwtSecretHex}
  );

  return {
    client: ELClient.Geth,
    id,
    engineRpcUrl,
    ethRpcUrl,
    ttd,
    jwtSecretHex,
    provider,
    job,
  };
};
