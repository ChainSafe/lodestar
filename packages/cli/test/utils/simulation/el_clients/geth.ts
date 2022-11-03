/* eslint-disable @typescript-eslint/naming-convention */
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import got from "got";
import {ZERO_HASH} from "@lodestar/state-transition";
import {
  ELClient,
  ELClientGenerator,
  ELClientOptions,
  ELNode,
  ELStartMode,
  JobOptions,
  Runner,
  RunnerType,
} from "../interfaces.js";
import {Eth1ProviderWithAdmin} from "../Eth1ProviderWithAdmin.js";
import {getGenesisBlock} from "./genesis.js";

const SECRET_KEY = "45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8";
const PASSWORD = "12345678";
const GENESIS_ACCOUNT = "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b";

export const generateGethNode: ELClientGenerator = (opts: ELClientOptions, runner: Runner) => {
  if (runner.type !== RunnerType.ChildProcess) {
    throw new Error(`Runner "${runner.type}" not yet supported.`);
  }

  const elBinaryDir = process.env.GETH_BINARY_DIR;

  if (!elBinaryDir) {
    throw Error(`EL ENV must be provided, GETH_BINARY_DIR: ${process.env.GETH_BINARY_DIR}`);
  }

  const {id, mode, dataDir, ethPort, port, enginePort, ttd, logFilePath, jwtSecretHex, cliqueSealingPeriod} = opts;

  const ethRpcUrl = `http://127.0.0.1:${ethPort}`;
  const engineRpcUrl = `http://127.0.0.1:${enginePort}`;
  const binaryPath = `${elBinaryDir}/geth`;
  const skPath = join(dataDir, "sk.json");
  const genesisPath = join(dataDir, "genesis.json");
  const passwordPath = join(dataDir, "password.txt");
  const jwtSecretPath = join(dataDir, "jwtsecret");

  const initJobOptions: JobOptions = {
    bootstrap: async () => {
      await mkdir(dataDir, {recursive: true});
      await writeFile(genesisPath, JSON.stringify(getGenesisBlock(mode, {ttd, cliqueSealingPeriod})));
    },
    cli: {
      command: binaryPath,
      args: ["--datadir", dataDir, "init", genesisPath],
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
  };

  const importJobOptions: JobOptions = {
    bootstrap: async () => {
      await writeFile(skPath, SECRET_KEY);
      await writeFile(passwordPath, PASSWORD);
      await writeFile(jwtSecretPath, jwtSecretHex);
    },
    cli: {
      command: binaryPath,
      args: ["--datadir", dataDir, "account", "import", "--password", passwordPath, skPath],
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
  };

  const startJobOptions: JobOptions = {
    cli: {
      command: binaryPath,
      args: [
        "--http",
        "--http.api",
        "engine,net,eth,miner,admin",
        "--http.port",
        String(ethPort as number),
        "--authrpc.port",
        String(enginePort as number),
        "--port",
        String(port as number),
        "--authrpc.jwtsecret",
        jwtSecretPath,
        "--datadir",
        dataDir,
        "--allow-insecure-unlock",
        "--unlock",
        GENESIS_ACCOUNT,
        "--password",
        passwordPath,
        "--syncmode",
        "full",
        // Logging verbosity: 0=silent, 1=error, 2=warn, 3=info, 4=debug, 5=detail
        "--verbosity",
        "4",
        ...(mode == ELStartMode.PreMerge ? ["--mine", "--nodiscover"] : []),
      ],
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
    health: async (): Promise<boolean> => {
      try {
        await got.post(ethRpcUrl, {json: {jsonrpc: "2.0", method: "net_version", params: [], id: 67}});
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  const job = runner.create(id, [{...initJobOptions, children: [{...importJobOptions, children: [startJobOptions]}]}]);

  const provider = new Eth1ProviderWithAdmin(
    {DEPOSIT_CONTRACT_ADDRESS: ZERO_HASH},
    // To allow admin_* RPC methods had to add "ethRpcUrl"
    {providerUrls: [ethRpcUrl, engineRpcUrl], jwtSecretHex}
  );

  const node: ELNode = {
    client: ELClient.Geth,
    id,
    engineRpcUrl,
    ethRpcUrl,
    ttd,
    jwtSecretHex,
    provider,
  };

  return {job, node};
};
