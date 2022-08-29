import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {ChildProcess, spawn} from "node:child_process";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {SimulationOptionalParams, SimulationParams} from "./types.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
export const __dirname = dirname(fileURLToPath(import.meta.url));

export const defaultSimulationParams: SimulationOptionalParams = {
  validatorsPerClient: 32 * 4,
  withExternalSigner: false,
  slotsPerEpoch: SLOTS_PER_EPOCH,
  secondsPerSlot: 2,
  // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
  // allow time for bls worker threads to warm up
  genesisSlotsDelay: 20,
};

export const INTEROP_BLOCK_HASH = Buffer.alloc(32, "B");

export const getSimulationId = ({
  validatorClients: validatorClientCount,
  validatorsPerClient,
  withExternalSigner,
  altairEpoch,
  bellatrixEpoch,
}: SimulationParams): string =>
  `vc-${validatorClientCount}_vpc-${validatorsPerClient}_${
    withExternalSigner ? "external_signer" : "local_signer"
  }_altair-${altairEpoch}_bellatrix-${bellatrixEpoch}`;

export const spawnProcessAndWait = async (
  module: string,
  args: string[],
  ready: (childProcess: ChildProcess) => Promise<boolean>
): Promise<ChildProcess> => {
  return new Promise((resolve, reject) => {
    void (async () => {
      const childProcess = spawn(module, args, {
        detached: false,
        stdio: "inherit",
        env: process.env,
      });

      childProcess.on("error", reject);
      childProcess.on("exit", (code: number) => {
        reject(new Error(`lodestar exited with code ${code}`));
      });

      // TODO: Add support for timeout
      const intervalId = setInterval(async () => {
        if (await ready(childProcess)) {
          clearInterval(intervalId);
          resolve(childProcess);
        } else {
          console.log("Waiting for beacon node to start.");
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

export const waitForSlot = async (params: SimulationParams, slot: Slot): Promise<void> {
  if (slot <= 0) {
    return;
  }

  const slotStartSec = params.genesisTime + slot * params.secondsPerSlot;
  const msToSlot = slotStartSec * 1000 - Date.now();

  if (msToSlot < 0) {
    throw Error("Requested slot is in past");
  }

  await new Promise((resolve) => setTimeout(resolve, msToSlot));
}
