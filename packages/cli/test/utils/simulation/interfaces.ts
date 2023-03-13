/* eslint-disable @typescript-eslint/naming-convention */
import {ChildProcess} from "node:child_process";
import type {SecretKey} from "@chainsafe/bls/types";
import {Api} from "@lodestar/api";
import {Api as KeyManagerApi} from "@lodestar/api/keymanager";
import {ChainConfig, ChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {Slot, allForks, Epoch} from "@lodestar/types";
import {BeaconArgs} from "../../../src/cmds/beacon/options.js";
import {GlobalArgs} from "../../../src/options/index.js";
import {EpochClock} from "./EpochClock.js";
import {Eth1ProviderWithAdmin} from "./Eth1ProviderWithAdmin.js";

export type NodeId = string;

export type SimulationInitOptions = {
  id: string;
  logsDir: string;
  chainConfig: AtLeast<ChainConfig, "ALTAIR_FORK_EPOCH" | "BELLATRIX_FORK_EPOCH" | "GENESIS_DELAY">;
};

export type SimulationOptions = {
  id: string;
  logsDir: string;
  rootDir: string;
  controller: AbortController;
  genesisTime: number;
};

export enum CLClient {
  Lodestar = "lodestar",
  Lighthouse = "lighthouse",
}

export enum ELClient {
  Mock = "mock",
  Geth = "geth",
  Nethermind = "nethermind",
}

export enum ELStartMode {
  PreMerge = "pre-merge",
  PostMerge = "post-merge",
}

export type CLClientsOptions = {
  [CLClient.Lodestar]: Partial<BeaconArgs & GlobalArgs>;
  [CLClient.Lighthouse]: Record<string, unknown>;
};

export type ELClientsOptions = {
  [ELClient.Mock]: string[];
  [ELClient.Geth]: string[];
  [ELClient.Nethermind]: string[];
};

export interface NodePairOptions<C extends CLClient = CLClient, E extends ELClient = ELClient> {
  keysCount: number;
  remote?: boolean;
  mining?: boolean;
  id: string;
  cl: C | {type: C; options: Partial<CLClientGeneratorOptions<C>>};
  el: E | {type: E; options: Partial<ELGeneratorGenesisOptions<E>>};
}

export type CLClientKeys =
  | {type: "local"; secretKeys: SecretKey[]}
  | {type: "remote"; secretKeys: SecretKey[]}
  | {type: "no-keys"};

export interface CLClientGeneratorOptions<C extends CLClient = CLClient> {
  id: string;
  nodeIndex: number;
  paths: CLPaths;
  address: string;
  config: ChainForkConfig;
  keys: CLClientKeys;
  genesisTime: number;
  engineUrls: string[];
  engineMock: boolean;
  clientOptions: CLClientsOptions[C];
}

export interface ELGeneratorGenesisOptions<E extends ELClient = ELClient> {
  ttd: bigint;
  cliqueSealingPeriod: number;
  clientOptions: ELClientsOptions[E];
}

export interface ELGeneratorClientOptions<E extends ELClient = ELClient> extends ELGeneratorGenesisOptions {
  mode: ELStartMode;
  nodeIndex: number;
  id: string;
  address: string;
  mining: boolean;
  paths: ELPaths;
  clientOptions: ELClientsOptions[E];
}

export type LodestarAPI = Api;
export type LighthouseAPI = Omit<Api, "lodestar"> & {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  lighthouse: {
    getPeers(): Promise<{
      status: number;
      body: {
        peer_id: string;
        peer_info: {
          score: {
            Real: {
              lighthouse_score: number;
              gossipsub_score: number;
              ignore_negative_gossipsub_score: boolean;
              score: number;
            };
          };
        };
      }[];
    }>;
  };
};

export interface CLNode<C extends CLClient = CLClient> {
  readonly client: C;
  readonly id: string;
  readonly url: string;
  readonly api: C extends CLClient.Lodestar ? LodestarAPI : LighthouseAPI;
  readonly keyManager: KeyManagerApi;
  readonly keys: CLClientKeys;
  readonly job: Job;
}

export interface ELNode<E extends ELClient = ELClient> {
  readonly client: E;
  readonly id: string;
  readonly ttd: bigint;
  readonly engineRpcUrl: string;
  readonly ethRpcUrl: string;
  readonly jwtSecretHex: string;
  readonly provider: E extends ELClient.Mock ? null : Eth1ProviderWithAdmin;
  readonly job: Job;
}

export interface NodePair {
  readonly id: string;
  readonly cl: CLNode;
  readonly el: ELNode;
}

export type CLClientGenerator<C extends CLClient> = (opts: CLClientGeneratorOptions<C>, runner: IRunner) => CLNode;
export type ELClientGenerator<E extends ELClient> = (opts: ELGeneratorClientOptions<E>, runner: IRunner) => ELNode;

export type HealthStatus = {ok: true} | {ok: false; reason: string; checkId: string};

export type JobOptions<T extends RunnerType = RunnerType.ChildProcess | RunnerType.Docker> = {
  readonly id: string;

  readonly cli: {
    readonly command: string;
    readonly args: string[];
    readonly env?: Record<string, string>;
  };

  readonly logs: {
    readonly stdoutFilePath: string;
  };

  // The job is meant to run with following runner
  readonly type: T;

  // Nested children runs in sequence, while the array of jobs runs in parallel
  readonly children?: JobOptions<RunnerType>[];

  // Will be called frequently to check the health of job startup
  // If not present then wait for the job to exit
  health?(): Promise<HealthStatus>;

  // Called once before the `job.start` is called
  bootstrap?(): Promise<void>;

  // Called once before the `job.stop` is called
  teardown?(): Promise<void>;

  // Runner specific options
} & {
  [T2 in T]: RunnerOptions[T2] extends never ? {readonly options?: undefined} : {readonly options: RunnerOptions[T2]};
}[T];

export interface Job {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export enum RunnerType {
  ChildProcess = "child_process",
  Docker = "docker",
}

export type RunnerOptions = {
  [RunnerType.ChildProcess]: never;
  [RunnerType.Docker]: {
    image: string;
    mounts?: [[string, string]];
    exposePorts?: number[];
    dockerNetworkIp?: string;
  };
};

export interface IRunner {
  create: (jobOptions: JobOptions[]) => Job;
  on(event: RunnerEvent, cb: (id: string) => void | Promise<void>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  getNextIp(): string;
}

export interface RunnerEnv<T extends RunnerType> {
  type: T;
  create: (jobOption: Omit<JobOptions<T>, "children">) => Job;
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
  forkConfig: ChainForkConfig;
  dependantStores: D;
};

export type SimulationAssertionInput<T, D extends Record<string, unknown> = Record<string, never>> = {
  slot: Slot;
  epoch: Epoch;
  clock: EpochClock;
  nodes: NodePair[];
  store: Record<NodeId, Record<Slot, T>>;
  dependantStores: D;
  forkConfig: ChainForkConfig;
};

export type SimulationMatcherInput = {
  slot: Slot;
  epoch: Epoch;
  clock: EpochClock;
  forkConfig: ChainForkConfig;
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
export type ChildProcessWithJobOptions = {jobOptions: JobOptions; childProcess: ChildProcess};

export type Eth1GenesisBlock = {
  config: {
    chainId: number;
    clique: Record<string, unknown>;
    terminalTotalDifficulty: string;
  };
  alloc: Record<string, {balance: string}>;
};

export abstract class SimulationReporter<T extends SimulationAssertion[]> {
  constructor(
    protected options: {
      clock: EpochClock;
      forkConfig: ChainForkConfig;
      stores: StoreTypes<T>;
      nodes: NodePair[];
      errors: SimulationAssertionError[];
    }
  ) {}
  abstract bootstrap(): void;
  abstract progress(slot: Slot): void;
  abstract summary(): void;
}

export interface CLPaths {
  rootDir: string;
  dataDir: string;
  genesisFilePath: string;
  jwtsecretFilePath: string;
  validatorsDir: string;
  keystoresDir: string;
  keystoresSecretsDir: string;
  keystoresSecretFilePath: string;
  validatorsDefinitionFilePath: string;
  logFilePath: string;
}

export interface ELPaths {
  rootDir: string;
  dataDir: string;
  genesisFilePath: string;
  jwtsecretFilePath: string;
  logFilePath: string;
}

export type MountedPaths<T> = T &
  {
    [P in keyof T as `${string & P}Mounted`]: T[P];
  };
