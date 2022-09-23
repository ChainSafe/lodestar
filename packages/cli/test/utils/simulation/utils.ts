import {ChildProcess, spawn} from "node:child_process";
import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {Epoch} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {SimulationOptionalParams, SimulationParams} from "./types.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
export const __dirname = dirname(fileURLToPath(import.meta.url));

export const logFilesDir = "test-logs";

export const defaultSimulationParams: SimulationOptionalParams = {
  validatorsPerClient: 32,
  withExternalSigner: false,
  secondsPerSlot: 2,
  // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
  // allow time for bls worker threads to warm up
  genesisSlotsDelay: 30,
  externalSigner: false,
};

export const getSimulationId = ({
  beaconNodes,
  validatorClients,
  validatorsPerClient,
  withExternalSigner,
  altairEpoch,
  bellatrixEpoch,
}: SimulationParams): string =>
  [
    `beaconNodes-${beaconNodes}`,
    `validatorClients-${validatorClients}`,
    `validatorsPerClient-${validatorsPerClient}`,
    `altair-${altairEpoch}`,
    `bellatrix-${bellatrixEpoch}`,
    `externalSigner-${withExternalSigner ? "yes" : "no"}`,
  ].join("_");

export const spawnProcessAndWait = async (
  module: string,
  args: string[],
  ready: (childProcess: ChildProcess) => Promise<boolean>,
  message: string
): Promise<ChildProcess> => {
  return new Promise((resolve, reject) => {
    void (async () => {
      const childProcess = spawn(module, args, {
        detached: false,
        stdio: process.env.SHOW_LOGS ? "inherit" : "ignore",
        // eslint-disable-next-line @typescript-eslint/naming-convention
        env: {...process.env, NODE_ENV: "test"},
      });

      childProcess.on("error", reject);
      childProcess.on("exit", (code: number) => {
        reject(new Error(`lodestar exited with code ${code}`));
      });

      // TODO: Add support for timeout
      // To safe the space in logs log only for once.
      console.log(message);
      const intervalId = setInterval(async () => {
        if (await ready(childProcess)) {
          clearInterval(intervalId);
          resolve(childProcess);
        }
      }, 1000);
    })();
  });
};

export const closeChildProcess = async (childProcess: ChildProcess, signal?: "SIGTERM"): Promise<void> => {
  return new Promise((resolve) => {
    childProcess.on("close", resolve);
    childProcess.kill(signal);
  });
};


export const avg = (arr: number[]): number => {
  return arr.length === 0 ? 0 : arr.reduce((p, c) => p + c, 0) / arr.length;
};

export const getForkName = (epoch: Epoch, params: SimulationParams): ForkName => {
  if (epoch < params.altairEpoch) {
    return ForkName.phase0;
  } else if (epoch < params.bellatrixEpoch) {
    return ForkName.altair;
  } else {
    return ForkName.bellatrix;
  }
};

export const FAR_FUTURE_EPOCH = 10 ** 12;
export const BN_P2P_BASE_PORT = 4000;
export const BN_P2P_REST_PORT = 5000;
export const KEY_MANAGER_BASE_PORT = 6000;
export const EXTERNAL_SIGNER_BASE_PORT = 7000;
