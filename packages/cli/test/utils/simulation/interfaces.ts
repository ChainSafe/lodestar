import type {SecretKey} from "@chainsafe/bls/types";
import {Api} from "@lodestar/api";
import {Api as KeyManagerApi} from "@lodestar/api/keymanager";
import {Eth1Provider} from "@lodestar/beacon-node";
import {IChainConfig, IChainForkConfig} from "@lodestar/config";

export type SimulationInitOptions = {
  id: string;
  logsDir: string;
  chainConfig: AtLeast<IChainConfig, "ALTAIR_FORK_EPOCH" | "BELLATRIX_FORK_EPOCH" | "GENESIS_DELAY">;
};

export type SimulationOptions = {
  id: string;
  logsDir: string;
  rootDir: string;
  runnerType: RunnerType;
  controller: AbortController;
  genesisTime: number;
};

export enum CLClient {
  Lodestar = "lodestar",
}

export enum ELClient {
  Geth = "geth",
}

export enum ELStartMode {
  PreMerge = "pre-merge",
  PostMerge = "post-merge",
}

export interface NodePairOptions {
  el: ELClient;
  cl: CLClient;
  keysCount: number;
  id: string;
}

export interface CLClientOptions {
  id: string;
  dataDir: string;
  logFilePath: string;
  genesisStateFilePath: string;
  address: string;
  restPort: number;
  port: number;
  keyManagerPort: number;
  config: IChainForkConfig;
  localKeys: SecretKey[];
  remoteKeys: SecretKey[];
  checkpointSyncUrl?: string;
  wssCheckpoint?: string;
  genesisTime: number;
  engineUrl: string;
  jwtSecretHex: string;
}

export interface ELClientOptions {
  mode: ELStartMode;
  id: string;
  ttd: bigint;
  logFilePath: string;
  dataDir: string;
  jwtSecretHex: string;
  enginePort: number;
  ethPort: number;
  port: number;
}

export interface CLNode {
  readonly client: CLClient;
  readonly id: string;
  readonly url: string;
  readonly api: Api;
  readonly keyManager: KeyManagerApi;
  readonly localKeys: SecretKey[];
  readonly remoteKeys: SecretKey[];
}

export interface ELNode {
  readonly client: ELClient;
  readonly id: string;
  readonly ttd: bigint;
  readonly engineRpcUrl: string;
  readonly ethRpcUrl: string;
  readonly jwtSecretHex: string;
  readonly provider: Eth1Provider;
}

export interface NodePair {
  readonly id: string;
  readonly cl: CLNode;
  readonly el: ELNode;
}

export type CLClientGenerator = (opts: CLClientOptions, runner: Runner) => {job: Job; node: CLNode};
export type ELClientGenerator = (opts: ELClientOptions, runner: Runner) => {job: Job; node: ELNode};

export interface JobOptions {
  readonly cli: {
    readonly command: string;
    readonly args: string[];
    readonly env?: Record<string, string>;
  };

  readonly logs: {
    readonly stdoutFilePath: string;
  };

  // Nested children runs in sequence, while the array of jobs runs in parallel
  readonly children?: JobOptions[];

  // Will be called frequently to check the health of job startup
  // If not present then wait for the job to exit
  health?(): Promise<boolean>;

  // Called once before the `job.start` is called
  bootstrap?(): Promise<void>;

  // Called once before the `job.stop` is called
  teardown?(): Promise<void>;
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

export type AtLeast<T, K extends keyof T> = Partial<T> & Pick<T, K>;
