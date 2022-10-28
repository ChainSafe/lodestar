import {mkdir, rmdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {
  ELClient,
  ELClientGenerator,
  ELClientOptions,
  ELStartMode,
  JobOptions,
  Runner,
  RunnerType,
} from "../interfaces.js";
import {callHttp} from "../utils.js";

const getGenesisBlock = (ttd: number, mode: ELStartMode): Record<string, unknown> => {
  if (mode === ELStartMode.PreMerge) {
    return {
      config: {
        chainId: 1,
        homesteadBlock: 0,
        eip150Block: 0,
        eip150Hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        eip155Block: 0,
        eip158Block: 0,
        byzantiumBlock: 0,
        constantinopleBlock: 0,
        petersburgBlock: 0,
        istanbulBlock: 0,
        muirGlacierBlock: 0,
        berlinBlock: 0,
        londonBlock: 0,
        clique: {
          period: 5,
          epoch: 30000,
        },
        terminalTotalDifficulty: ttd,
      },
      nonce: "0x42",
      timestamp: "0x0",
      extraData:
        "0x0000000000000000000000000000000000000000000000000000000000000000a94f5374fce5edbc8e2a8697c15331677e6ebf0b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      gasLimit: "0x1c9c380",
      difficulty: "0x0",
      mixHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      coinbase: "0x0000000000000000000000000000000000000000",
      alloc: {
        "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b": {balance: "0x6d6172697573766477000000"},
      },
      number: "0x0",
      gasUsed: "0x0",
      parentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      baseFeePerGas: "0x7",
    };
  }

  return {
    config: {
      chainId: 1,
      homesteadBlock: 0,
      eip150Block: 0,
      eip155Block: 0,
      eip158Block: 0,
      byzantiumBlock: 0,
      constantinopleBlock: 0,
      petersburgBlock: 0,
      istanbulBlock: 0,
      muirGlacierBlock: 0,
      berlinBlock: 0,
      londonBlock: 0,
      clique: {
        period: 5,
        epoch: 30000,
      },
      terminalTotalDifficulty: ttd,
    },
    nonce: "0x42",
    timestamp: "0x0",
    extraData:
      "0x0000000000000000000000000000000000000000000000000000000000000000a94f5374fce5edbc8e2a8697c15331677e6ebf0b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    gasLimit: "0x1C9C380",
    difficulty: "0x400000000",
    mixHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    coinbase: "0x0000000000000000000000000000000000000000",
    alloc: {
      "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b": {balance: "0x6d6172697573766477000000"},
    },
    number: "0x0",
    gasUsed: "0x0",
    parentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    baseFeePerGas: "0x7",
  };
};

const SECRET_KEY = "45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8";
const PASSWORD = "12345678";
const GENESIS_ACCOUNT = "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b";

export const generateGethNode: ELClientGenerator = (opts: ELClientOptions, runner: Runner) => {
  if (runner.type !== RunnerType.ChildProcess) {
    throw new Error(`Runner "${runner.type}" not yet supported.`);
  }

  const elBinaryDir = process.env.EL_BINARY_DIR;

  if (!elBinaryDir) {
    throw Error(`EL ENV must be provided, EL_BINARY_DIR: ${process.env.EL_BINARY_DIR}`);
  }

  const {id, mode, dataDir, ethPort, enginePort, ttd, logFilePath, jwtSecretHex} = opts;

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
      await writeFile(genesisPath, JSON.stringify(getGenesisBlock(Number(ttd), mode)));
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
        "engine,net,eth,miner",
        "--http.port",
        String(ethPort as number),
        "--authrpc.port",
        String(enginePort as number),
        "--authrpc.jwtsecret",
        jwtSecretPath,
        "--datadir",
        dataDir,
        "--allow-insecure-unlock",
        "--unlock",
        GENESIS_ACCOUNT,
        "--password",
        passwordPath,
        "--syncmode full",
        ...(mode == ELStartMode.PreMerge ? ["--nodiscover", "--mine"] : []),
      ],
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
    health: async (): Promise<boolean> => {
      try {
        console.log("Waiting for EL online...");
        await callHttp(ethRpcUrl, "POST", {jsonrpc: "2.0", method: "net_version", params: [], id: 67});
        console.log("Waiting for few seconds for EL to fully setup, for e.g. unlock the account...");
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  const job = runner.create(id, [{...initJobOptions, children: [{...importJobOptions, children: [startJobOptions]}]}]);

  const genesisBlockHash = "";

  const node = {
    client: ELClient.Geth,
    id,
    engineRpcUrl,
    ethRpcUrl,
    ttd,
    jwtSecretHex,
    genesisBlockHash,
  };

  return {job, node};
};
