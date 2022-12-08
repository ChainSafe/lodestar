/* eslint-disable @typescript-eslint/naming-convention */
import {EventEmitter} from "node:events";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import tmp from "tmp";
import {fromHexString} from "@chainsafe/ssz";
import {nodeUtils} from "@lodestar/beacon-node";
import {createIChainForkConfig, IChainForkConfig} from "@lodestar/config";
import {activePreset} from "@lodestar/params";
import {BeaconStateAllForks, interopSecretKey} from "@lodestar/state-transition";
import {generateLodestarBeaconNode} from "./cl_clients/lodestar.js";
import {
  BN_P2P_BASE_PORT,
  BN_REST_BASE_PORT,
  CLIQUE_SEALING_PERIOD,
  EL_ENGINE_BASE_PORT,
  EL_ETH_BASE_PORT,
  EL_P2P_BASE_PORT,
  KEY_MANAGER_BASE_PORT,
  SIM_TESTS_SECONDS_PER_SLOT,
} from "./constants.js";
import {generateGethNode} from "./el_clients/geth.js";
import {generateMockNode} from "./el_clients/mock.js";
import {generateNethermindNode} from "./el_clients/nethermind.js";
import {EpochClock} from "./EpochClock.js";
import {ExternalSignerServer} from "./ExternalSignerServer.js";
import {
  AtLeast,
  CLClient,
  CLClientGeneratorOptions,
  CLClientsOptions,
  CLNode,
  ELClient,
  ELClientsOptions,
  ELGeneratorClientOptions,
  ELNode,
  ELStartMode,
  Job,
  JobPair,
  NodePair,
  NodePairOptions,
  NodePairResult,
  SimulationInitOptions,
  SimulationOptions,
} from "./interfaces.js";
import {ChildProcessRunner} from "./runner/ChildProcessRunner.js";
import {DockerRunner} from "./runner/DockerRunner.js";
import {SimulationTracker} from "./SimulationTracker.js";
import {getEstimatedTTD} from "./utils/index.js";

export const SHARED_JWT_SECRET = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";

/* eslint-disable no-console */

export class SimulationEnvironment {
  readonly nodes: NodePair[] = [];
  readonly clock: EpochClock;
  readonly tracker: SimulationTracker;
  readonly emitter: EventEmitter;
  readonly childProcessRunner: ChildProcessRunner;
  readonly dockerRunner: DockerRunner;
  readonly externalSigner: ExternalSignerServer;

  readonly forkConfig: IChainForkConfig;
  readonly options: SimulationOptions;

  private readonly jobs: JobPair[] = [];
  private keysCount = 0;
  private nodePairCount = 0;
  private genesisState?: BeaconStateAllForks;
  private genesisStatePath: string;

  private constructor(forkConfig: IChainForkConfig, options: SimulationOptions) {
    this.forkConfig = forkConfig;
    this.options = options;
    this.genesisStatePath = join(this.options.rootDir, "genesis.ssz");

    this.clock = new EpochClock({
      genesisTime: this.options.genesisTime,
      secondsPerSlot: this.forkConfig.SECONDS_PER_SLOT,
      slotsPerEpoch: activePreset.SLOTS_PER_EPOCH,
      signal: this.options.controller.signal,
    });

    this.emitter = new EventEmitter();
    this.externalSigner = new ExternalSignerServer([]);

    this.childProcessRunner = new ChildProcessRunner();
    this.dockerRunner = new DockerRunner(join(this.options.logsDir, "docker_runner.log"));

    this.tracker = SimulationTracker.initWithDefaultAssertions({
      nodes: [],
      config: this.forkConfig,
      clock: this.clock,
      signal: this.options.controller.signal,
    });
  }

  static initWithDefaults(
    {chainConfig, logsDir, id}: SimulationInitOptions,
    clients: NodePairOptions[]
  ): SimulationEnvironment {
    const secondsPerSlot = chainConfig.SECONDS_PER_SLOT ?? SIM_TESTS_SECONDS_PER_SLOT;
    const genesisTime = Math.floor(Date.now() / 1000) + chainConfig.GENESIS_DELAY * secondsPerSlot;
    const ttd =
      chainConfig.TERMINAL_TOTAL_DIFFICULTY ??
      getEstimatedTTD({
        genesisDelay: chainConfig.GENESIS_DELAY,
        bellatrixForkEpoch: chainConfig.BELLATRIX_FORK_EPOCH,
        secondsPerSlot: secondsPerSlot,
        cliqueSealingPeriod: CLIQUE_SEALING_PERIOD,
        // Make sure bellatrix started before TTD reach, so we wait for few more slots to be sure
        additionalSlots: activePreset.SLOTS_PER_EPOCH - 2,
      });

    const forkConfig = createIChainForkConfig({
      ...chainConfig,
      SECONDS_PER_SLOT: secondsPerSlot,
      TERMINAL_TOTAL_DIFFICULTY: ttd,
    });

    const env = new SimulationEnvironment(forkConfig, {
      logsDir,
      id,
      genesisTime,
      controller: new AbortController(),
      rootDir: join(tmp.dirSync({unsafeCleanup: true, tmpdir: "/tmp", template: "sim-XXXXXX"}).name, id),
    });

    for (const client of clients) {
      const result = env.createNodePair(client);
      env.jobs.push(result.jobs);
      env.nodes.push(result.nodePair);
    }

    return env;
  }

  async start(timeout: number): Promise<void> {
    try {
      setTimeout(async () => {
        await this.stop(1, "On timeout");
      }, timeout);

      process.on("unhandledRejection", async (reason, promise) => {
        console.error("Unhandled Rejection at:", promise, "reason:", reason);
        await this.stop(1, "Unhandled promise rejection");
      });

      process.on("uncaughtException", async (err) => {
        console.error("Uncaught exception:", err);
        await this.stop(1, "Uncaught exception");
      });

      process.on("SIGTERM", async () => {
        await this.stop(0, "Terminating");
      });
      process.on("SIGINT", async () => {
        await this.stop(0, "Terminating");
      });

      await mkdir(this.options.rootDir);

      await this.dockerRunner.start();
      await Promise.all(this.jobs.map((j) => j.el.start()));

      for (let i = 0; i < this.nodes.length; i++) {
        // Get genesis block hash
        const el = this.nodes[i].el;

        if (el.provider === null) {
          continue;
        }

        const eth1Genesis = await el.provider.getBlockByNumber(0);
        if (!eth1Genesis) {
          throw new Error(`Eth1 genesis not found for node "${this.nodes[i].id}"`);
        }

        const genesisState = nodeUtils.initDevState(this.forkConfig, this.keysCount, {
          genesisTime: this.options.genesisTime,
          eth1BlockHash: fromHexString(eth1Genesis.hash),
        }).state;

        this.genesisState = genesisState;
      }

      if (!this.genesisState) {
        throw new Error("The genesis state for CL clients is not defined.");
      }

      await writeFile(this.genesisStatePath, this.genesisState.serialize());

      await Promise.all(this.jobs.map((j) => j.cl.start()));

      await this.externalSigner.start();
      for (const node of this.nodes) {
        const remoteKeys = node.cl.remoteKeys;
        this.externalSigner.addKeys(remoteKeys);
        await node.cl.keyManager.importRemoteKeys(
          remoteKeys.map((sk) => ({pubkey: sk.toPublicKey().toHex(), url: this.externalSigner.url}))
        );
      }

      await this.tracker.start();
      await Promise.all(this.nodes.map((node) => this.tracker.track(node)));
    } catch (error) {
      await this.stop(1, `Caused error in startup. ${(error as Error).message}`);
    }
  }

  async stop(code = 0, message = "On completion."): Promise<void> {
    process.removeAllListeners("unhandledRejection");
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    console.log(`Simulation environment "${this.options.id}" is stopping: ${message}`);
    this.options.controller.abort();
    await this.tracker.stop();
    await Promise.all(this.jobs.map((j) => j.el.stop()));
    await Promise.all(this.jobs.map((j) => j.cl.stop()));
    await this.externalSigner.stop();
    await this.dockerRunner.stop();

    if (this.tracker.getErrorCount() > 0) {
      this.tracker.reporter.summary();
      process.exit(this.tracker.getErrorCount() > 0 ? 1 : code);
    } else {
      process.exit(code);
    }
  }

  createNodePair<C extends CLClient, E extends ELClient>({
    el,
    cl,
    keysCount,
    id,
    remote,
    mining,
  }: NodePairOptions<C, E>): NodePairResult {
    if (this.genesisState && keysCount > 0) {
      throw new Error("Genesis state already initialized. Can not add more keys to it.");
    }

    this.nodePairCount += 1;

    const keys = Array.from({length: keysCount}, (_, vi) => {
      return interopSecretKey(this.keysCount + vi);
    });
    this.keysCount += keysCount;

    const clClient = this.createCLNode(cl, {
      id,
      remoteKeys: remote ? keys : [],
      localKeys: remote ? [] : keys,
      engineMock: typeof el === "string" ? el === ELClient.Mock : el.type === ELClient.Mock,
    });

    const elClient = this.createELNode(el, {id, mining});

    return {
      nodePair: {id, el: elClient?.node, cl: clClient.node},
      jobs: {el: elClient?.job, cl: clClient.job},
    };
  }

  private createCLNode<C extends CLClient>(
    client: C | {type: C; options: CLClientsOptions[C]},
    options?: AtLeast<CLClientGeneratorOptions, "remoteKeys" | "localKeys" | "id">
  ): {job: Job; node: CLNode} {
    const clientType = typeof client === "object" ? client.type : client;
    const clientOptions = typeof client === "object" ? client.options : undefined;

    const clId = `${options?.id}-cl-${clientType}`;

    switch (clientType) {
      case CLClient.Lodestar: {
        const opts: CLClientGeneratorOptions = {
          id: clId,
          dataDir: join(this.options.rootDir, clId),
          logFilePath: join(this.options.logsDir, `${clId}.log`),
          genesisStateFilePath: this.genesisStatePath,
          restPort: BN_REST_BASE_PORT + this.nodePairCount + 1,
          port: BN_P2P_BASE_PORT + this.nodePairCount + 1,
          keyManagerPort: KEY_MANAGER_BASE_PORT + this.nodePairCount + 1,
          config: this.forkConfig,
          address: "127.0.0.1",
          remoteKeys: options?.remoteKeys ?? [],
          localKeys: options?.localKeys ?? [],
          genesisTime: this.options.genesisTime,
          engineUrl: options?.engineUrl ?? `http://127.0.0.1:${EL_ENGINE_BASE_PORT + this.nodePairCount + 1}`,
          engineMock: options?.engineMock ?? false,
          jwtSecretHex: options?.jwtSecretHex ?? SHARED_JWT_SECRET,
          clientOptions: clientOptions ?? {},
        };
        return generateLodestarBeaconNode(opts, this.childProcessRunner);
      }
      default:
        throw new Error(`CL Client "${client}" not supported`);
    }
  }

  private createELNode<E extends ELClient>(
    client: E | {type: E; options: ELClientsOptions[E]},
    options: AtLeast<ELGeneratorClientOptions, "id">
  ): {job: Job; node: ELNode} {
    const clientType = typeof client === "object" ? client.type : client;
    const clientOptions = typeof client === "object" ? client.options : undefined;

    const elId = `${options.id}-el-${clientType}`;

    const opts: ELGeneratorClientOptions<E> = {
      id: elId,
      mode: options?.mode ?? (this.forkConfig.BELLATRIX_FORK_EPOCH > 0 ? ELStartMode.PreMerge : ELStartMode.PostMerge),
      ttd: options?.ttd ?? this.forkConfig.TERMINAL_TOTAL_DIFFICULTY,
      cliqueSealingPeriod: options?.cliqueSealingPeriod ?? CLIQUE_SEALING_PERIOD,
      logFilePath: options?.logFilePath ?? join(this.options.logsDir, `${elId}.log`),
      dataDir: options?.dataDir ?? join(this.options.rootDir, elId),
      jwtSecretHex: options?.jwtSecretHex ?? SHARED_JWT_SECRET,
      enginePort: options?.enginePort ?? EL_ENGINE_BASE_PORT + this.nodePairCount + 1,
      ethPort: options?.ethPort ?? EL_ETH_BASE_PORT + this.nodePairCount + 1,
      port: options?.port ?? EL_P2P_BASE_PORT + this.nodePairCount + 1,
      address: this.dockerRunner.getNextIp(),
      mining: options?.mining ?? false,
      clientOptions: clientOptions ?? [],
    };

    switch (clientType) {
      case ELClient.Mock: {
        return generateMockNode(opts as ELGeneratorClientOptions<ELClient.Mock>, this.childProcessRunner);
      }
      case ELClient.Geth: {
        return generateGethNode(opts as ELGeneratorClientOptions<ELClient.Geth>, this.dockerRunner);
      }
      case ELClient.Nethermind: {
        return generateNethermindNode(opts as ELGeneratorClientOptions<ELClient.Nethermind>, this.dockerRunner);
      }
      default:
        throw new Error(`EL Client "${client}" not supported`);
    }
  }
}
