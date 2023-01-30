import {ChildProcess} from "node:child_process";
import type {SecretKey} from "@chainsafe/bls/types";
import {Api} from "@lodestar/api";
import {Api as KeyManagerApi} from "@lodestar/api/keymanager";
import {IChainConfig, IChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {Slot, allForks, Epoch} from "@lodestar/types";
import {IBeaconArgs} from "../../../src/cmds/beacon/options.js";
import {IGlobalArgs} from "../../../src/options/index.js";
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
  controller: AbortController;
  genesisTime: number;
};

export enum CLClient {
  Lodestar = "lodestar",
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
  [CLClient.Lodestar]: Partial<IBeaconArgs & IGlobalArgs>;
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
  dataDir: string;
  logFilePath: string;
  genesisStateFilePath: string;
  address: string;
  restPort: number;
  port: number;
  keyManagerPort: number;
  config: IChainForkConfig;
  keys: CLClientKeys;
  genesisTime: number;
  engineUrls: string[];
  engineMock: boolean;
  jwtSecretHex: string;
  clientOptions: CLClientsOptions[C];
}

export interface ELGeneratorGenesisOptions<E extends ELClient = ELClient> {
  ttd: bigint;
  cliqueSealingPeriod: number;
  clientOptions: ELClientsOptions[E];
}

export interface ELGeneratorClientOptions<E extends ELClient = ELClient> extends ELGeneratorGenesisOptions {
  mode: ELStartMode;
  id: string;
  logFilePath: string;
  dataDir: string;
  jwtSecretHex: string;
  enginePort: number;
  ethPort: number;
  port: number;
  address: string;
  mining: boolean;
  clientOptions: ELClientsOptions[E];
}

export interface CLNode {
  readonly client: CLClient;
  readonly id: string;
  readonly url: string;
  readonly api: Api;
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

export type CLClientGenerator<C extends CLClient> = (
  opts: CLClientGeneratorOptions<C>,
  runner: Runner<RunnerType.ChildProcess> | Runner<RunnerType.Docker>
) => CLNode;
export type ELClientGenerator<E extends ELClient> = (
  opts: ELGeneratorClientOptions<E>,
  runner: Runner<RunnerType.ChildProcess> | Runner<RunnerType.Docker>
) => ELNode;

export type HealthStatus = {ok: true} | {ok: false; reason: string; checkId: string};

export interface JobOptions {
  readonly id: string;

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
  health?(): Promise<HealthStatus>;

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
  Docker = "docker",
}

export type RunnerOptions = {
  [RunnerType.ChildProcess]: never;
  [RunnerType.Docker]: {
    image: string;
    dataVolumePath: string;
    exposePorts: number[];
    dockerNetworkIp: string;
  };
};

export interface Runner<T extends RunnerType> {
  type: T;
  create: (
    id: string,
    jobOptions: JobOptions[],
    ...options: RunnerOptions[T] extends never ? [undefined?] : [RunnerOptions[T]]
  ) => Job;
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
      forkConfig: IChainForkConfig;
      stores: StoreTypes<T>;
      nodes: NodePair[];
      errors: SimulationAssertionError[];
    }
  ) {}
  abstract bootstrap(): void;
  abstract progress(slot: Slot): void;
  abstract summary(): void;
}
