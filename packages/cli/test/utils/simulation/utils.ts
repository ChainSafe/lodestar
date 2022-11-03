import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {Epoch} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {RunnerType, SimulationOptionalParams, SimulationParams} from "./interfaces.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
export const __dirname = dirname(fileURLToPath(import.meta.url));

export const logFilesDir = "test-logs";

export const defaultSimulationParams: SimulationOptionalParams = {
  validatorsPerClient: 32,
  secondsPerSlot: 4,
  // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
  // allow time for bls worker threads to warm up
  genesisSlotsDelay: 30,
  externalKeysPercentage: 0.5,
  runnerType: RunnerType.ChildProcess,
};

export const getSimulationId = ({
  beaconNodes,
  validatorClients,
  validatorsPerClient,
  altairEpoch,
  bellatrixEpoch,
}: SimulationParams): string =>
  [
    `beaconNodes-${beaconNodes}`,
    `validatorClients-${validatorClients}`,
    `validatorsPerClient-${validatorsPerClient}`,
    `altair-${altairEpoch}`,
    `bellatrix-${bellatrixEpoch}`,
  ].join("_");

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
export const BN_REST_BASE_PORT = 5000;
export const KEY_MANAGER_BASE_PORT = 6000;
export const EXTERNAL_SIGNER_BASE_PORT = 7000;
export const LODESTAR_BINARY_PATH = `${__dirname}/../../../bin/lodestar.js`;
