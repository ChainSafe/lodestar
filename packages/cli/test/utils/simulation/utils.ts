import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {ChildProcess, spawn} from "node:child_process";
import {altair, phase0, Slot} from "@lodestar/types";
import {
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_TARGET_FLAG_INDEX,
  TIMELY_SOURCE_FLAG_INDEX,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {SimulationOptionalParams, SimulationParams} from "./types.js";

const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
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
  externalSigner: false,
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
        stdio: process.env.SHOW_LOGS ? "inherit" : "ignore",
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

export const computeAttestationParticipation = (
  state: altair.BeaconState
): {epoch: number; head: number; source: number; target: number} => {
  // Attestation to be computed at the end of epoch. At that time the "currentEpochParticipation" is all set to zero
  // and we have to use "previousEpochParticipation" instead.
  const previousEpochParticipation = state.previousEpochParticipation;
  // As we calculated the participation from the previous epoch
  const epoch = Math.floor(state.slot / SLOTS_PER_EPOCH) - 1;
  const totalAttestingBalance = {head: 0, source: 0, target: 0};
  let totalEffectiveBalance = 0;

  for (let i = 0; i < previousEpochParticipation.length; i++) {
    totalAttestingBalance.head += previousEpochParticipation[i] & TIMELY_HEAD ? state.balances[i] : 0;
    totalAttestingBalance.source += previousEpochParticipation[i] & TIMELY_SOURCE ? state.balances[i] : 0;
    totalAttestingBalance.target += previousEpochParticipation[i] & TIMELY_TARGET ? state.balances[i] : 0;

    totalEffectiveBalance += state.validators[i].effectiveBalance;
  }

  totalAttestingBalance.head = totalAttestingBalance.head / totalEffectiveBalance;
  totalAttestingBalance.source = totalAttestingBalance.source / totalEffectiveBalance;
  totalAttestingBalance.target = totalAttestingBalance.target / totalEffectiveBalance;

  return {...totalAttestingBalance, epoch};
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
export const BN_P2P_BASE_PORT = 4000;
export const BN_P2P_REST_PORT = 5000;
export const KEY_MANAGER_BASE_PORT = 6000;
export const EXTERNAL_SIGNER_BASE_PORT = 7000;
