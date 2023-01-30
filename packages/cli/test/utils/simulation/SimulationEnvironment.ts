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
  MOCK_ETH1_GENESIS_HASH,
  SHARED_JWT_SECRET,
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
  CLNode,
  ELClient,
  ELGeneratorClientOptions,
  ELNode,
  ELStartMode,
  NodePair,
  NodePairOptions,
  SimulationInitOptions,
  SimulationOptions,
} from "./interfaces.js";
import {ChildProcessRunner} from "./runner/ChildProcessRunner.js";
import {DockerRunner} from "./runner/DockerRunner.js";
import {SimulationTracker} from "./SimulationTracker.js";
import {getEstimatedTTD} from "./utils/index.js";

interface StartOpts {
  runTimeoutMs: number;
}

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
      env.nodes.push(env.createNodePair(client));
    }

    return env;
  }

  async start(opts: StartOpts): Promise<void> {
    const currentTime = Date.now();
    setTimeout(() => {
      const slots = this.clock.getSlotFor(currentTime + opts.runTimeoutMs);
      const epoch = this.clock.getEpochForSlot(slots);
      const slot = this.clock.getSlotIndexInEpoch(slots);

      this.stop(1, `Sim run timedout in ${opts.runTimeoutMs}ms (approx. ${epoch}/${slot}).`).catch((e) =>
        console.error("Error on stop", e)
      );
    }, opts.runTimeoutMs);

    const msToGenesis = this.clock.msToGenesis();
    const startTimeout = setTimeout(() => {
      const slots = this.clock.getSlotFor(currentTime + msToGenesis);
      const epoch = this.clock.getEpochForSlot(slots);
      const slot = this.clock.getSlotIndexInEpoch(slots);

      this.stop(
        1,
        `Start sequence not completed before genesis, in ${msToGenesis}ms (approx. ${epoch}/${slot}).`
      ).catch((e) => console.error("Error on stop", e));
    }, msToGenesis);

    try {
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
      await Promise.all(this.nodes.map((node) => node.el.job.start()));

      for (let i = 0; i < this.nodes.length; i++) {
        // Get genesis block hash
        const el = this.nodes[i].el;

        // If eth1 is mock then genesis hash would be empty
        const eth1Genesis =
          el.provider === null ? {hash: MOCK_ETH1_GENESIS_HASH} : await el.provider.getBlockByNumber(0);

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

      await Promise.all(this.nodes.map((node) => node.cl.job.start()));

      if (this.nodes.some((node) => node.cl.keys.type === "remote")) {
        console.log("Starting external signer...");
        await this.externalSigner.start();
        console.log("Started external signer");

        for (const node of this.nodes) {
          if (node.cl.keys.type === "remote") {
            this.externalSigner.addKeys(node.cl.keys.secretKeys);
            await node.cl.keyManager.importRemoteKeys(
              node.cl.keys.secretKeys.map((sk) => ({pubkey: sk.toPublicKey().toHex(), url: this.externalSigner.url}))
            );
            console.log(`Imported remote keys for node ${node.id}`);
          }
        }
      }

      await this.tracker.start();
      await Promise.all(this.nodes.map((node) => this.tracker.track(node)));
    } catch (error) {
      await this.stop(1, `Error in startup. ${(error as Error).stack}`);
    } finally {
      clearTimeout(startTimeout);
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
    await Promise.all(this.nodes.map((node) => node.el.job.stop()));
    await Promise.all(this.nodes.map((node) => node.cl.job.stop()));
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
  }: NodePairOptions<C, E>): NodePair {
    if (this.genesisState && keysCount > 0) {
      throw new Error("Genesis state already initialized. Can not add more keys to it.");
    }

    this.nodePairCount += 1;

    const keys = Array.from({length: keysCount}, (_, vi) => {
      return interopSecretKey(this.keysCount + vi);
    });
    this.keysCount += keysCount;

    const clType = typeof cl === "object" ? cl.type : cl;
    const clOptions = typeof cl === "object" ? cl.options : {};
    const clNode = this.createCLNode(clType, {
      ...clOptions,
      id,
      keys:
        keys.length > 0 && remote
          ? {type: "remote", secretKeys: keys}
          : keys.length > 0
          ? {type: "local", secretKeys: keys}
          : {type: "no-keys"},
      engineMock: typeof el === "string" ? el === ELClient.Mock : el.type === ELClient.Mock,
    });

    const elType = typeof el === "object" ? el.type : el;
    const elOptions = typeof el === "object" ? el.options : {};
    const elNode = this.createELNode(elType, {...elOptions, id, mining});

    return {id, el: elNode, cl: clNode};
  }

  private createCLNode<C extends CLClient>(
    client: C,
    options?: AtLeast<CLClientGeneratorOptions<C>, "keys" | "id">
  ): CLNode {
    const clId = `${options?.id}-cl-${client}`;

    switch (client) {
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
          keys: options?.keys ?? {type: "no-keys"},
          genesisTime: this.options.genesisTime,
          engineUrls: options?.engineUrls
            ? [`http://127.0.0.1:${EL_ENGINE_BASE_PORT + this.nodePairCount + 1}`, ...options.engineUrls]
            : [`http://127.0.0.1:${EL_ENGINE_BASE_PORT + this.nodePairCount + 1}`],
          engineMock: options?.engineMock ?? false,
          jwtSecretHex: options?.jwtSecretHex ?? SHARED_JWT_SECRET,
          clientOptions: options?.clientOptions ?? {},
        };
        return generateLodestarBeaconNode(opts, this.childProcessRunner);
      }
      default:
        throw new Error(`CL Client "${client}" not supported`);
    }
  }

  private createELNode<E extends ELClient>(client: E, options: AtLeast<ELGeneratorClientOptions<E>, "id">): ELNode {
    const elId = `${options.id}-el-${client}`;

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
      clientOptions: options.clientOptions ?? [],
    };

    switch (client) {
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
