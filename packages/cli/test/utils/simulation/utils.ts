import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {ChildProcess, spawn} from "node:child_process";
import {altair, phase0, Slot} from "@lodestar/types";
import {TIMELY_HEAD_FLAG_INDEX, TIMELY_TARGET_FLAG_INDEX} from "@lodestar/params";
import {SimulationOptionalParams, SimulationParams} from "./types.js";

const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;

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
  ready: (childProcess: ChildProcess) => Promise<boolean>,
  message: string
): Promise<ChildProcess> => {
  return new Promise((resolve, reject) => {
    void (async () => {
      const childProcess = spawn(module, args, {
        detached: false,
        stdio: "inherit",
        // eslint-disable-next-line @typescript-eslint/naming-convention
        env: {...process.env, NODE_ENV: "test"},
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
          console.info(message);
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

export const computeAttestationParticipation = (state: altair.BeaconState, type: "HEAD" | "FFG"): number => {
  // Attestation to be computed at the end of epoch. At that time the "currentEpochParticipation" is all set to zero
  // and we have to use "previousEpochParticipation" instead.
  const previousEpochParticipation = state.previousEpochParticipation;
  let totalAttestingBalance = 0;
  let totalActiveBalance = 0;

  const participationFlag = type === "HEAD" ? TIMELY_HEAD : TIMELY_TARGET;

  for (let i = 0; i < previousEpochParticipation.length; i++) {
    totalAttestingBalance += previousEpochParticipation[i] & participationFlag ? state.balances[i] : 0;
    totalActiveBalance += state.validators[i].effectiveBalance;
  }

  return totalAttestingBalance / totalActiveBalance;
};

export const computeAttestation = (attestations: phase0.Attestation[]): number => {
  return Array.from(attestations).reduce((total, att) => total + att.aggregationBits.getTrueBitIndexes().length, 0);
};

export const computeInclusionDelay = (attestations: phase0.Attestation[], slot: Slot): number => {
  return avg(Array.from(attestations).map((att) => slot - att.data.slot));
};

export const avg = (arr: number[]): number => {
  return arr.length === 0 ? 0 : arr.reduce((p, c) => p + c, 0) / arr.length;
};

export const FAR_FUTURE_EPOCH = 10 ** 12;
