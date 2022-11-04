import type {SecretKey} from "@chainsafe/bls/types";
import {Api} from "@lodestar/api";
import {Api as KeyManagerApi} from "@lodestar/api/keymanager";
import {IChainConfig, IChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {Slot, allForks, Epoch} from "@lodestar/types";
import {EpochClock} from "./EpochClock.js";
import {Eth1ProviderWithAdmin} from "./Eth1ProviderWithAdmin.js";

export type NodeId = string;

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
  wssCheckpoint?: string;
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

export interface ELGenesisOptions {
  ttd: bigint;
  cliqueSealingPeriod: number;
}

export interface ELClientOptions extends ELGenesisOptions {
  mode: ELStartMode;
  id: string;
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
  readonly provider: Eth1ProviderWithAdmin;
}

export interface NodePair {
  readonly id: string;
  readonly cl: CLNode;
  readonly el: ELNode;
}

export interface NodePairResult {
  nodePair: NodePair;
  jobs: {el: Job; cl: Job};
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

export type SimulationCaptureInput<T, D extends Record<string, unknown> = Record<string, never>> = {
  fork: ForkName;
  slot: Slot;
  epoch: Epoch;
  block: allForks.SignedBeaconBlock;
  clock: EpochClock;
  node: NodePair;
  store: Record<Slot, T>;
  forkConfig: IChainForkConfig;
  dependantStores: D;
};

export type SimulationAssertionInput<T, D extends Record<string, unknown> = Record<string, never>> = {
  slot: Slot;
  epoch: Epoch;
  clock: EpochClock;
  nodes: NodePair[];
  store: Record<NodeId, Record<Slot, T>>;
  dependantStores: D;
  forkConfig: IChainForkConfig;
};

export type SimulationMatcherInput = {
  slot: Slot;
  epoch: Epoch;
  clock: EpochClock;
  forkConfig: IChainForkConfig;
};

export type AssertionMatcher = (input: SimulationMatcherInput) => boolean | {match: boolean; remove: boolean};
export type ExtractAssertionType<T, I> = T extends SimulationAssertion<infer A, infer B>
  ? A extends I
    ? B
    : never
  : never;
export type ExtractAssertionId<T> = T extends SimulationAssertion<infer A, any> ? A : never;
export type StoreType<AssertionId extends string, Value = unknown> = Record<
  AssertionId,
  Record<NodeId, Record<Slot, Value>>
>;
export type StoreTypes<T extends SimulationAssertion[], IDs extends string = ExtractAssertionId<T[number]>> = {
  [Id in IDs]: Record<NodeId, Record<Slot, ExtractAssertionType<T[number], Id>>>;
};
export interface SimulationAssertion<
  IdType extends string = string,
  ValueType = unknown,
  Dependencies extends SimulationAssertion[] = SimulationAssertion<string, unknown, any[]>[]
> {
  readonly id: IdType;
  capture?(input: SimulationCaptureInput<ValueType, StoreTypes<Dependencies>>): Promise<ValueType | null>;
  match: AssertionMatcher;
  assert(input: SimulationAssertionInput<ValueType, StoreTypes<Dependencies>>): Promise<string[] | null | never>;
  dependencies?: Dependencies;
}
export interface SimulationAssertionError {
  slot: Slot;
  epoch: Epoch;
  assertionId: string;
  message: string;
}
