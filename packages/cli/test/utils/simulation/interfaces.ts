/* eslint-disable @typescript-eslint/naming-convention */
import {ChildProcess} from "node:child_process";
import type {SecretKey} from "@chainsafe/bls/types";
import {Api} from "@lodestar/api";
import {Api as KeyManagerApi} from "@lodestar/api/keymanager";
import {ChainConfig, ChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {Slot, allForks, Epoch} from "@lodestar/types";
import {BeaconArgs} from "../../../src/cmds/beacon/options.js";
import {IValidatorCliArgs} from "../../../src/cmds/validator/options.js";
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
  elGenesisTime: number;
};

export enum BeaconClient {
  Lodestar = "beacon_lodestar",
  Lighthouse = "beacon_lighthouse",
}

export enum ValidatorClient {
  Lodestar = "validator_lodestar",
  Lighthouse = "validator_lighthouse",
}

export enum ExecutionClient {
  Mock = "execution_mock",
  Geth = "execution_geth",
  Nethermind = "execution_nethermind",
}

export enum ExecutionStartMode {
  PreMerge = "pre-merge",
  PostMerge = "post-merge",
}

export type BeaconClientsOptions = {
  [BeaconClient.Lodestar]: Partial<BeaconArgs & GlobalArgs>;
  [BeaconClient.Lighthouse]: Record<string, unknown>;
};

export type ValidatorClientsOptions = {
  [ValidatorClient.Lodestar]: Partial<IValidatorCliArgs & GlobalArgs>;
  [ValidatorClient.Lighthouse]: Record<string, unknown>;
};

export type ExecutionClientsOptions = {
  [ExecutionClient.Mock]: string[];
  [ExecutionClient.Geth]: string[];
  [ExecutionClient.Nethermind]: string[];
};

export type ExecutionNodeDefinition<E extends ExecutionClient> =
  | E
  | {type: E; options: Partial<ExecutionGenesisOptions<E>>};
export type BeaconNodeDefinition<E extends BeaconClient> = E | {type: E; options: Partial<BeaconGeneratorOptions<E>>};
export type ValidatorNodeDefinition<E extends ValidatorClient> =
  | E
  | {type: E; options: Partial<ValidatorGeneratorOptions<E>>};

export interface NodePairDefinition<
  B extends BeaconClient = BeaconClient,
  E extends ExecutionClient = ExecutionClient,
  V extends ValidatorClient = ValidatorClient,
> {
  keysCount: number;
  remote?: boolean;
  mining?: boolean;
  id: string;
  beacon: BeaconNodeDefinition<B>;
  execution: ExecutionNodeDefinition<E>;
  validator?: ValidatorNodeDefinition<V>;
}

export type ValidatorClientKeys =
  | {type: "local"; secretKeys: SecretKey[]}
  | {type: "remote"; secretKeys: SecretKey[]}
  | {type: "no-keys"};

export interface GeneratorOptions {
  id: string;
  nodeIndex: number;
  address: string;
  forkConfig: ChainForkConfig;
  genesisTime: number;
  runner: IRunner;
}

export interface BeaconGeneratorOptions<C extends BeaconClient = BeaconClient> extends GeneratorOptions {
  paths: BeaconPaths;
  engineUrls: string[];
  engineMock: boolean;
  clientOptions: BeaconClientsOptions[C];
  metrics?: {
    host: string;
    port: number;
  };
}

export interface ValidatorGeneratorOptions<V extends ValidatorClient = ValidatorClient> extends GeneratorOptions {
  paths: ValidatorPaths;
  keys: ValidatorClientKeys;
  beaconUrls: string[];
  clientOptions: ValidatorClientsOptions[V];
  metrics?: {
    host: string;
    port: number;
  };
}

export interface ExecutionGenesisOptions<E extends ExecutionClient = ExecutionClient> {
  ttd: bigint;
  cliqueSealingPeriod: number;
  shanghaiTime: number;
  genesisTime: number;
  clientOptions: ExecutionClientsOptions[E];
}

export interface ExecutionGeneratorOptions<E extends ExecutionClient = ExecutionClient>
  extends ExecutionGenesisOptions<E>,
    GeneratorOptions {
  mode: ExecutionStartMode;
  mining: boolean;
  paths: ExecutionPaths;
  clientOptions: ExecutionClientsOptions[E];
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

export interface BeaconNode<C extends BeaconClient = BeaconClient> {
  readonly client: C;
  readonly id: string;
  /**
   * Beacon Node Rest API URL accessible form the host machine if the process is running in private network inside docker
   */
  readonly restPublicUrl: string;
  /**
   * Beacon Node Rest API URL accessible within private network
   */
  readonly restPrivateUrl: string;
  readonly api: C extends BeaconClient.Lodestar ? LodestarAPI : LighthouseAPI;
  readonly job: Job;
}

export interface ValidatorNode<C extends ValidatorClient = ValidatorClient> {
  readonly client: C;
  readonly id: string;
  readonly keyManager: KeyManagerApi;
  readonly keys: ValidatorClientKeys;
  readonly job: Job;
}

export interface ExecutionNode<E extends ExecutionClient = ExecutionClient> {
  readonly client: E;
  readonly id: string;
  readonly ttd: bigint;
  /**
   * Engine URL accessible form the host machine if the process is running in private network inside docker
   */
  readonly engineRpcPublicUrl: string;
  /**
   * Engine URL accessible within private network inside docker
   */
  readonly engineRpcPrivateUrl: string;
  /**
   * RPC URL accessible form the host machine if the process is running in private network inside docker
   */
  readonly ethRpcPublicUrl: string;
  /**
   * RPC URL accessible within private network inside docker
   */
  readonly ethRpcPrivateUrl: string;
  readonly jwtSecretHex: string;
  readonly provider: E extends ExecutionClient.Mock ? null : Eth1ProviderWithAdmin;
  readonly job: Job;
}

export interface NodePair {
  readonly id: string;
  readonly beacon: BeaconNode;
  readonly execution: ExecutionNode;
  readonly validator?: ValidatorNode;
}

export type BeaconNodeGenerator<C extends BeaconClient> = (
  opts: BeaconGeneratorOptions<C>,
  runner: IRunner
) => BeaconNode;
export type ValidatorNodeGenerator<C extends ValidatorClient> = (
  opts: ValidatorGeneratorOptions<C>,
  runner: IRunner
) => ValidatorNode;
export type ExecutionNodeGenerator<E extends ExecutionClient> = (
  opts: ExecutionGeneratorOptions<E>,
  runner: IRunner
) => ExecutionNode;

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

export interface AssertionInput {
  fork: ForkName;
  forkConfig: ChainForkConfig;
  slot: Slot;
  epoch: Epoch;
  clock: EpochClock;
  node: NodePair;
}

export interface SimulationCaptureInput<D extends Record<string, unknown>> extends AssertionInput {
  block: allForks.SignedBeaconBlock;
  dependantStores: D;
}

export interface SimulationAssertionInput<T, D extends Record<string, unknown> = Record<string, never>>
  extends AssertionInput {
  nodes: NodePair[];
  store: Record<Slot, T>;
  dependantStores: D;
}

export type SimulationMatcherInput = AssertionInput;

/**
 * Bitwise flag to indicate what to do with the assertion
 * 1. Capture the assertion
 * 2. Assert the assertion
 * 3. Remove the assertion
 *
 * @example
 * Capture and assert: `AssertionMatch.Capture | AssertionMatch.Assert`
 */
export enum AssertionMatch {
  None = 0,
  Capture = 1 << 0,
  Assert = 1 << 1,
  Remove = 1 << 2,
}
export type AssertionMatcher = (input: SimulationMatcherInput) => AssertionMatch;
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
  [Id in IDs]: Record<NodeId, Record<Slot, ExtractAssertionType<T[number], Id> | undefined>>;
};
export interface SimulationAssertion<
  IdType extends string = string,
  ValueType = unknown,
  Dependencies extends SimulationAssertion[] = SimulationAssertion<string, unknown, any[]>[],
> {
  readonly id: IdType;
  capture?(
    input: SimulationCaptureInput<StoreTypes<Dependencies> & StoreType<IdType, ValueType>>
  ): Promise<ValueType | null>;
  match: AssertionMatcher;
  assert(
    input: SimulationAssertionInput<ValueType, StoreTypes<Dependencies> & StoreType<IdType, ValueType>>
  ): Promise<AssertionResult[] | never>;
  dependencies?: Dependencies;
}
export type AssertionResult = string | [string, Record<string, unknown>];

export interface SimulationAssertionError {
  slot: Slot;
  epoch: Epoch;
  assertionId: string;
  nodeId: string;
  message: string;
  data?: Record<string, unknown>;
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

export interface CommonPaths {
  rootDir: string;
  dataDir: string;
  jwtsecretFilePath: string;
  logFilePath: string;
}

export interface BeaconPaths extends CommonPaths {
  genesisFilePath: string;
}

export interface ValidatorPaths extends CommonPaths {
  keystoresDir: string;
  keystoresSecretsDir: string;
  keystoresSecretFilePath: string;
  validatorsDir: string;
  validatorsDefinitionFilePath: string;
}

export interface ExecutionPaths extends CommonPaths {
  genesisFilePath: string;
}

export type MountedPaths<T> = T & {
  [P in keyof T as `${string & P}Mounted`]: T[P];
};
