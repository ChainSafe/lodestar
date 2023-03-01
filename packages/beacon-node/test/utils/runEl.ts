import fs from "node:fs";
import net from "node:net";
import {spawn} from "node:child_process";
import {sleep} from "@lodestar/utils";
import {ChainConfig} from "@lodestar/config";
import {Eth1Provider} from "../../src/index.js";
import {ZERO_HASH} from "../../src/constants/index.js";
import {shell} from "../sim/shell.js";

/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable no-console */

export enum ELStartMode {
  PreMerge = "pre-merge",
  PostMerge = "post-merge",
}

export type ELSetupConfig = {mode: ELStartMode; elScriptDir: string; elBinaryDir: string; genesisTemplate?: string};
export type ELRunOptions = {ttd: bigint; dataPath: string; jwtSecretHex: string; enginePort: number; ethPort: number};
export type ELClient = {
  genesisBlockHash: string;
  ttd: bigint;
  engineRpcUrl: string;
  ethRpcUrl: string;
  network: string;
  jwtSecretHex: string;
};

/**
 * A util function to start an EL in a "pre-merge" or "post-merge" mode using an `elScriptDir` setup
 * scripts folder  in packages/beacon-node/test/scripts/el-interop.
 *
 * Returns an ELRunConfig after starting the EL, which can be used to initialize the genesis
 * state in lodestar.
 */

export async function runEL(
  {mode, elScriptDir, elBinaryDir, genesisTemplate: template}: ELSetupConfig,
  {ttd, dataPath, jwtSecretHex, enginePort, ethPort}: ELRunOptions,
  signal: AbortSignal
): Promise<{elClient: ELClient; tearDownCallBack: () => Promise<void>}> {
  const network = `${elScriptDir}/${mode}`;
  const ethRpcUrl = `http://127.0.0.1:${ethPort}`;
  const engineRpcUrl = `http://127.0.0.1:${enginePort}`;
  const genesisTemplate = template ?? "genesisPre.tmpl";

  await shell(`sudo rm -rf ${dataPath}`);
  fs.mkdirSync(dataPath, {recursive: true});

  const tearDownCallBack = await startELProcess({
    runScriptPath: `./test/scripts/el-interop/${network}.sh`,
    TTD: `${ttd}`,
    DATA_DIR: dataPath,
    EL_BINARY_DIR: elBinaryDir,
    ENGINE_PORT: `${enginePort}`,
    ETH_PORT: `${ethPort}`,
    JWT_SECRET_HEX: jwtSecretHex,
    TEMPLATE_FILE: genesisTemplate,
  });

  // Wait for Geth to be online
  try {
    await waitForELOnline(engineRpcUrl, signal);
    // Fetch genesis block hash
    const genesisBlockHash = await getGenesisBlockHash({providerUrl: engineRpcUrl, jwtSecretHex}, signal);
    const elClient = {genesisBlockHash, ttd, engineRpcUrl, ethRpcUrl, jwtSecretHex, network};
    return {elClient, tearDownCallBack};
  } catch (e) {
    console.log("Failed to start the EL, tearing down...");
    await tearDownCallBack();
    throw e;
  }
}

async function waitForELOnline(url: string, signal: AbortSignal): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      console.log("Waiting for EL online...");
      await shell(
        `curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"net_version","params":[],"id":67}' ${url}`
      );

      console.log("Waiting for few seconds for EL to fully setup, for e.g. unlock the account...");
      await sleep(5000, signal);
      return; // Done
    } catch (e) {
      await sleep(1000, signal);
    }
  }
  throw Error("EL not online in 60 seconds");
}

async function getGenesisBlockHash(
  {providerUrl, jwtSecretHex}: {providerUrl: string; jwtSecretHex?: string},
  signal: AbortSignal
): Promise<string> {
  const eth1Provider = new Eth1Provider(
    ({DEPOSIT_CONTRACT_ADDRESS: ZERO_HASH} as Partial<ChainConfig>) as ChainConfig,
    {providerUrls: [providerUrl], jwtSecretHex},
    signal
  );

  // Need to run multiple tries because nethermind sometimes is not yet ready and throws error
  // of connection refused while fetching genesis block
  for (let i = 1; i <= 60; i++) {
    console.log(`fetching genesisBlock hash, try: ${i}`);
    try {
      const genesisBlock = await eth1Provider.getBlockByNumber(0);
      console.log({genesisBlock});
      if (!genesisBlock) {
        throw Error("No genesis block available");
      }
      return genesisBlock.hash;
    } catch (e) {
      console.log(`genesisBlockHash fetch error: ${(e as Error).message}`);
    }
    await sleep(1000, signal);
  }
  throw Error("EL not ready with genesis even after 60 seconds");
}

async function startELProcess(args: {
  runScriptPath: string;
  TTD: string;
  DATA_DIR: string;
  EL_BINARY_DIR: string;
  ENGINE_PORT: string;
  ETH_PORT: string;
  JWT_SECRET_HEX: string;
  TEMPLATE_FILE: string;
}): Promise<() => Promise<void>> {
  const {runScriptPath, TTD, DATA_DIR, EL_BINARY_DIR, ENGINE_PORT, ETH_PORT, JWT_SECRET_HEX, TEMPLATE_FILE} = args;

  //Passing process.env as it might have important PATH/docker socket info set
  const gethProc = spawn(runScriptPath, [], {
    env: {
      ...process.env,
      EL_BINARY_DIR,
      ENGINE_PORT,
      ETH_PORT,
      TTD,
      DATA_DIR,
      JWT_SECRET_HEX,
      TEMPLATE_FILE,
    },
  });

  gethProc.stdout.on("data", (chunk) => {
    const str = Buffer.from(chunk).toString("utf8");
    process.stdout.write(`EL ${gethProc.pid}: ${str}`); // str already contains a new line. console.log adds a new line
  });
  gethProc.stderr.on("data", (chunk) => {
    const str = Buffer.from(chunk).toString("utf8");
    process.stderr.write(`EL ${gethProc.pid}: ${str}`); // str already contains a new line. console.log adds a new line
  });

  gethProc.on("exit", (code) => {
    console.log("EL exited", {code});
  });

  const tearDownCallBack: () => Promise<void> = async () => {
    console.log("tearDownCallBack", {pid: gethProc.pid});
    if (gethProc.killed) {
      throw Error("EL is killed before end of test");
    }

    console.log("Killing EL process", gethProc.pid);
    try {
      await shell(`pkill -15 -P ${gethProc.pid}`);
      await shell("docker rm -f custom-execution");
    } catch (e) {
      console.log("Killing EL error", (e as Error).message);
    }

    // Wait for the P2P to be offline
    await waitForELOffline(ENGINE_PORT);
    console.log("EL successfully killed!");
  };
  return tearDownCallBack;
}

async function waitForELOffline(ENGINE_PORT: string): Promise<void> {
  const port = parseInt(ENGINE_PORT);

  for (let i = 0; i < 60; i++) {
    console.log("Waiting for EL offline...");
    const isInUse = await isPortInUse(port);
    if (!isInUse) {
      return;
    }
    await sleep(1000);
  }
  throw Error("EL not offline in 60 seconds");
}

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", function (err) {
      if (((err as unknown) as {code: string}).code === "EADDRINUSE") {
        resolve(true);
      } else {
        reject(err);
      }
    });

    server.once("listening", function () {
      // close the server if listening doesn't fail
      server.close(() => {
        resolve(false);
      });
    });

    server.listen(port);
  });
}

export async function sendTransaction(url: string, transaction: Record<string, unknown>): Promise<void> {
  await shell(
    `curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_sendTransaction","params":[${JSON.stringify(
      transaction
    )}],"id":67}' ${url}`
  );
}

export async function getBalance(url: string, account: string): Promise<string> {
  const response: string = await shell(
    `curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_getBalance","params":["${account}","latest"],"id":67}' ${url}`
  );
  const {result} = (JSON.parse(response) as unknown) as Record<string, string>;
  return result;
}
