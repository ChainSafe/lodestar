/* eslint-disable no-console */
import {activePreset} from "@lodestar/params";
import {Epoch, Slot} from "@lodestar/types";
import {ETH_TTD_INCREMENT} from "../constants.js";
import {SimulationEnvironment} from "../SimulationEnvironment.js";

export const logFilesDir = "test-logs";

export const avg = (arr: number[]): number => {
  return arr.length === 0 ? 0 : arr.reduce((p, c) => p + c, 0) / arr.length;
};

export const getEstimatedTimeInSecForRun = ({
  genesisSlotDelay,
  runTill,
  secondsPerSlot,
  graceExtraTimeFraction,
}: {
  genesisSlotDelay: Slot;
  runTill: Epoch;
  secondsPerSlot: number;
  graceExtraTimeFraction: number;
}): number => {
  const durationSec = secondsPerSlot * activePreset.SLOTS_PER_EPOCH * runTill + secondsPerSlot * genesisSlotDelay;

  return Math.round(durationSec + durationSec * graceExtraTimeFraction);
};

export const getEstimatedTTD = ({
  genesisDelay,
  cliqueSealingPeriod,
  secondsPerSlot,
  additionalSlots,
  bellatrixForkEpoch,
}: {
  genesisDelay: number;
  cliqueSealingPeriod: number;
  additionalSlots: number;
  secondsPerSlot: number;
  bellatrixForkEpoch: number;
}): bigint => {
  const secondsTillBellatrix =
    genesisDelay * secondsPerSlot +
    (bellatrixForkEpoch - 1) * activePreset.SLOTS_PER_EPOCH * secondsPerSlot +
    additionalSlots * secondsPerSlot;

  return BigInt(Math.ceil(secondsTillBellatrix / cliqueSealingPeriod) * ETH_TTD_INCREMENT);
};

export const squeezeString = (val: string, length: number, sep = "..."): string => {
  const anchor = Math.floor((length - sep.length) / 2);

  return `${val.slice(0, anchor)}${sep}${val.slice(-anchor)}`;
};

export function arrayEquals(a: unknown[], b: unknown[]): boolean {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((val, index) => val === b[index]);
}

export const arrayGroupBy = <T>(
  array: T[],
  predicate: (value: T, index: number, array: T[]) => string
): Record<string, T[]> =>
  array.reduce((acc, value, index, array) => {
    (acc[predicate(value, index, array)] ||= []).push(value);
    return acc;
  }, {} as {[key: string]: T[]});

export function strFixedSize(str: string, width: number): string {
  return str.padEnd(width).slice(0, width);
}

export const arrayIsUnique = <T>(arr: T[], predicate?: (val: T) => unknown): boolean =>
  arr.length === new Set(predicate ? arr.map(predicate) : arr).size;

export const replaceIpFromUrl = (url: string, ip: string): string => url.replace(/(http:\/\/)(.*)(:)/, `$1${ip}$3`);

export const makeUniqueArray = <T>(arr: T[]): T[] => [...new Set(arr)];

export const regsiterProcessHandler = (env: SimulationEnvironment): void => {
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
