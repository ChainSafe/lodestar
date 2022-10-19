import type {SecretKey} from "@chainsafe/bls/types";
import {Api} from "@lodestar/api";
import {Api as KeyManagerApi} from "@lodestar/api/keymanager";
import {IChainForkConfig} from "@lodestar/config";
import {BeaconStateAllForks} from "@lodestar/state-transition/";

export type SimulationRequiredParams = {
  beaconNodes: number;
  validatorClients: number;
  altairEpoch: number;
  bellatrixEpoch: number;
  logFilesDir: string;
};

export type SimulationOptionalParams = {
  validatorsPerClient: number;
  secondsPerSlot: number;
  genesisSlotsDelay: number;
  anchorState?: BeaconStateAllForks;
  // Use this percentage for external signer and rest will be used for local key manager
  externalKeysPercentage: number;
  runnerType: RunnerType;
};

export type RunTimeSimulationParams = {
  genesisTime: number;
  slotsPerEpoch: number;
};

export type SimulationParams = SimulationRequiredParams & Required<SimulationOptionalParams> & RunTimeSimulationParams;

export enum CLClient {
  Lodestar = "lodestar",
}

export interface CLClientOptions {
  params: SimulationParams;
  id: string;
  rootDir: string;
  logFilePath: string;
  genesisStateFilePath: string;
  address: string;
  restPort: number;
  port: number;
  keyManagerPort: number;
  config: IChainForkConfig;
  secretKeys: SecretKey[];
}

export type CLClientGenerator = (opts: CLClientOptions, runner: Runner) => Job;

export interface JobOptions {
  readonly cli: {
    readonly command: string;
    readonly args: string[];
    readonly env: Record<string, string>;
  };
  readonly logs: {
    readonly stdoutFilePath: string;
  };
  // Nested jobs
  readonly children?: JobOptions[];
  health(): Promise<boolean>;
  bootstrap?(): Promise<void>;
  cleanup?(): Promise<void>;
}

export interface Job {
  type: RunnerType;
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export enum RunnerType {
  ChildProcess = "child_process",
}

export interface Runner {
  type: RunnerType;
  create: (id: string, options: JobOptions[]) => Job;
  on(event: RunnerEvent, cb: () => void | Promise<void>): void;
}

export type RunnerEvent = "starting" | "started" | "stopping" | "stop";

export interface CLParticipant {
  readonly id: string;
  readonly api: Api;
  readonly keyManager: KeyManagerApi;
  readonly secretKeys: SecretKey[];
}
