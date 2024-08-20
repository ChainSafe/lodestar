/* eslint-disable no-console */
import {activePreset} from "@lodestar/params";
import {Epoch} from "@lodestar/types";
import {ChainConfig, ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {
  CLIQUE_SEALING_PERIOD,
  ETH_TTD_INCREMENT,
  SIM_ENV_CHAIN_ID,
  SIM_ENV_NETWORK_ID,
  SIM_TESTS_SECONDS_PER_SLOT,
} from "../constants.js";
import {Simulation} from "../simulation.js";

export const logFilesDir = "test-logs";

export const avg = (arr: number[]): number => {
  return arr.length === 0 ? 0 : arr.reduce((p, c) => p + c, 0) / arr.length;
};

function getGenesisDelaySlots(initialNodes?: number): number {
  if (process.env.GENESIS_DELAY_SLOTS) {
    const genesisDelaySlots = parseInt(process.env.GENESIS_DELAY_SLOTS);
    // If custom job is invoked and want to use default genesis delay then provider -1 as value
    if (genesisDelaySlots >= 0) return genesisDelaySlots;
  }

  if (initialNodes == null) return 40;
  // Considering each node consists of EN, BN, VC and KM
  // EN - Execution Node - 15s
  const execution = 15;
  // BN - Beacon Node - 15s
  const beacon = 15;
  // VC - Validator Client - 10s
  const validator = 10;
  // KM - Key Manager - 3s
  const keyManager = 3;
  // Initial script launch time - 10s
  const initialLaunchScript = 10;

  return Math.ceil(
    ((execution + beacon + validator + keyManager) * initialNodes + initialLaunchScript) / SIM_TESTS_SECONDS_PER_SLOT
  );
}

export function defineSimTestConfig(
  opts: Partial<ChainConfig> & {
    cliqueSealingPeriod?: number;
    additionalSlotsForTTD?: number;
    runTillEpoch: number;
    // Used to calculate genesis delay
    initialNodes?: number;
  }
): {
  estimatedTimeoutMs: number;
  forkConfig: ChainForkConfig;
} {
  const genesisDelaySeconds = getGenesisDelaySlots(opts.initialNodes) * SIM_TESTS_SECONDS_PER_SLOT;

  const estimatedTimeoutMs =
    getEstimatedTimeInSecForRun({
      genesisDelaySeconds,
      secondsPerSlot: SIM_TESTS_SECONDS_PER_SLOT,
      runTill: opts.runTillEpoch,
      // After adding Nethermind its took longer to complete
      graceExtraTimeFraction: 0.5,
    }) * 1000;

  const ttd = getEstimatedTTD({
    bellatrixForkEpoch: opts.BELLATRIX_FORK_EPOCH ?? Infinity,
    secondsPerSlot: opts.SECONDS_PER_SLOT ?? SIM_TESTS_SECONDS_PER_SLOT,
    cliqueSealingPeriod: opts.cliqueSealingPeriod ?? CLIQUE_SEALING_PERIOD,
    // To make sure bellatrix already started
    additionalSlots: opts.additionalSlotsForTTD ?? 2,
  });

  /* eslint-disable @typescript-eslint/naming-convention */
  const forkConfig = createChainForkConfig({
    ...opts,
    GENESIS_DELAY: genesisDelaySeconds,
    SECONDS_PER_SLOT: opts.SECONDS_PER_SLOT ?? SIM_TESTS_SECONDS_PER_SLOT,
    TERMINAL_TOTAL_DIFFICULTY: ttd,
    DEPOSIT_CHAIN_ID: SIM_ENV_CHAIN_ID,
    DEPOSIT_NETWORK_ID: SIM_ENV_NETWORK_ID,
    SECONDS_PER_ETH1_BLOCK: opts.cliqueSealingPeriod ?? CLIQUE_SEALING_PERIOD,
    ETH1_FOLLOW_DISTANCE: 1,
  });
  /* eslint-enable @typescript-eslint/naming-convention */

  return {
    estimatedTimeoutMs,
    forkConfig,
  };
}

export const getEstimatedTimeInSecForRun = ({
  genesisDelaySeconds,
  runTill,
  secondsPerSlot,
  graceExtraTimeFraction,
}: {
  genesisDelaySeconds: number;
  runTill: Epoch;
  secondsPerSlot: number;
  graceExtraTimeFraction: number;
}): number => {
  const durationSec = secondsPerSlot * activePreset.SLOTS_PER_EPOCH * runTill + genesisDelaySeconds;

  return Math.round(durationSec + durationSec * graceExtraTimeFraction);
};

export const getEstimatedTTD = ({
  cliqueSealingPeriod,
  secondsPerSlot,
  additionalSlots,
  bellatrixForkEpoch,
}: {
  cliqueSealingPeriod: number;
  additionalSlots: number;
  secondsPerSlot: number;
  bellatrixForkEpoch: number;
}): bigint => {
  const secondsTillBellatrix =
    bellatrixForkEpoch * activePreset.SLOTS_PER_EPOCH * secondsPerSlot + additionalSlots * secondsPerSlot;

  return BigInt(Math.ceil(secondsTillBellatrix / cliqueSealingPeriod) * ETH_TTD_INCREMENT);
};

export const getEstimatedForkTime = ({
  genesisTime,
  secondsPerSlot,
  forkEpoch,
  additionalSlots,
}: {
  genesisTime: number;
  secondsPerSlot: number;
  forkEpoch: number;
  additionalSlots: number;
}): number => {
  const secondsTillFork = forkEpoch * activePreset.SLOTS_PER_EPOCH * secondsPerSlot;

  return genesisTime + secondsTillFork + additionalSlots * secondsPerSlot;
};

export const squeezeString = (val: string, length: number, sep = "..."): string => {
  const anchor = Math.floor((length - sep.length) / 2);

  return `${val.slice(0, anchor)}${sep}${val.slice(-anchor)}`;
};

export function arrayEquals(a: unknown[] | Uint8Array, b: unknown[] | Uint8Array): boolean {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((val, index) => val === b[index]);
}

export const arrayGroupBy = <T>(
  array: T[],
  predicate: (value: T, index: number, array: T[]) => string
): Record<string, T[]> =>
  array.reduce(
    (acc, value, index, array) => {
      (acc[predicate(value, index, array)] ||= []).push(value);
      return acc;
    },
    {} as {[key: string]: T[]}
  );

export function strFixedSize(str: string, width: number): string {
  return str.padEnd(width).slice(0, width);
}

export const isSingletonArray = <T>(arr: T[], predicate?: (val: T) => unknown): boolean =>
  new Set(predicate ? arr.map(predicate) : arr).size === 1;

export const replaceIpFromUrl = (url: string, ip: string): string => url.replace(/(http:\/\/)(.*)(:)/, `$1${ip}$3`);

export const makeUniqueArray = <T>(arr: T[]): T[] => [...new Set(arr)];

export const registerProcessHandler = (env: Simulation): void => {
  process.on("unhandledRejection", async (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    await env.stop(1, "Unhandled promise rejection");
  });

  process.on("uncaughtException", async (err) => {
    console.error("Uncaught exception:", err);
    await env.stop(1, "Uncaught exception");
  });

  process.on("SIGTERM", async () => {
    await env.stop(0, "Terminating");
  });
  process.on("SIGINT", async () => {
    await env.stop(0, "Terminating");
  });
};
