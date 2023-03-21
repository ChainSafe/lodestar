/* eslint-disable @typescript-eslint/naming-convention */
import {EventEmitter} from "node:events";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import fs from "node:fs";
import tmp from "tmp";
import {fromHexString} from "@chainsafe/ssz";
import {nodeUtils} from "@lodestar/beacon-node";
import {createChainForkConfig, ChainForkConfig} from "@lodestar/config";
import {activePreset} from "@lodestar/params";
import {BeaconStateAllForks, interopSecretKey} from "@lodestar/state-transition";
import {generateLodestarBeaconNode} from "./cl_clients/lodestar.js";
import {
  CLIQUE_SEALING_PERIOD,
  EL_ENGINE_BASE_PORT,
  MOCK_ETH1_GENESIS_HASH,
  SHARED_JWT_SECRET,
  SHARED_VALIDATOR_PASSWORD,
  SIM_ENV_CHAIN_ID,
  SIM_ENV_NETWORK_ID,
  SIM_TESTS_SECONDS_PER_SLOT,
} from "./constants.js";
import {generateGethNode} from "./el_clients/geth.js";
import {generateMockNode} from "./el_clients/mock.js";
import {generateNethermindNode} from "./el_clients/nethermind.js";
import {EpochClock, MS_IN_SEC} from "./EpochClock.js";
import {ExternalSignerServer} from "./ExternalSignerServer.js";
import {
  AtLeast,
  CLClient,
  CLClientGeneratorOptions,
  CLClientKeys,
  CLNode,
  ELClient,
  ELGeneratorClientOptions,
  ELNode,
  ELStartMode,
  IRunner,
  NodePair,
  NodePairOptions,
  SimulationInitOptions,
  SimulationOptions,
} from "./interfaces.js";
import {SimulationTracker} from "./SimulationTracker.js";
import {getEstimatedTTD, makeUniqueArray, regsiterProcessHandler, replaceIpFromUrl} from "./utils/index.js";
import {generateLighthouseBeaconNode} from "./cl_clients/lighthouse.js";
import {Runner} from "./runner/index.js";
import {createKeystores} from "./utils/keys.js";
import {getGethGenesisBlock} from "./utils/el_genesis.js";
import {createCLNodePaths, createELNodePaths, getCLNodePaths, getELNodePaths} from "./utils/paths.js";

interface StartOpts {
  runTimeoutMs: number;
}

/* eslint-disable no-console */

export class SimulationEnvironment {
  readonly nodes: NodePair[] = [];
  readonly clock: EpochClock;
  readonly tracker: SimulationTracker;
  readonly emitter: EventEmitter;
  readonly runner: IRunner;
  readonly externalSigner: ExternalSignerServer;

  readonly forkConfig: ChainForkConfig;
  readonly options: SimulationOptions;

  private keysCount = 0;
  private nodePairCount = 0;
  private genesisState?: BeaconStateAllForks;

  private constructor(forkConfig: ChainForkConfig, options: SimulationOptions) {
    this.forkConfig = forkConfig;
    this.options = options;

    this.clock = new EpochClock({
      genesisTime: this.options.genesisTime,
      secondsPerSlot: this.forkConfig.SECONDS_PER_SLOT,
      slotsPerEpoch: activePreset.SLOTS_PER_EPOCH,
      signal: this.options.controller.signal,
    });

    this.emitter = new EventEmitter();
    this.externalSigner = new ExternalSignerServer([]);
    this.runner = new Runner({logsDir: this.options.logsDir});
    this.tracker = SimulationTracker.initWithDefaultAssertions({
      nodes: [],
      config: this.forkConfig,
      clock: this.clock,
      signal: this.options.controller.signal,
    });
  }

  static async initWithDefaults(
    {chainConfig, logsDir, id}: SimulationInitOptions,
    clients: NodePairOptions[]
  ): Promise<SimulationEnvironment> {
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

    const forkConfig = createChainForkConfig({
      ...chainConfig,
      SECONDS_PER_SLOT: secondsPerSlot,
      TERMINAL_TOTAL_DIFFICULTY: ttd,
      DEPOSIT_CHAIN_ID: SIM_ENV_CHAIN_ID,
      DEPOSIT_NETWORK_ID: SIM_ENV_NETWORK_ID,
    });

    const env = new SimulationEnvironment(forkConfig, {
      logsDir,
      id,
      genesisTime,
      controller: new AbortController(),
      rootDir: path.join(tmp.dirSync({unsafeCleanup: true, tmpdir: "/tmp", template: "sim-XXXXXX"}).name, id),
    });

    for (const client of clients) {
      env.nodes.push(await env.createNodePair(client));
    }

    return env;
  }

  async start(opts: StartOpts): Promise<void> {
    const currentTime = Date.now();
    setTimeout(() => {
      const slots = this.clock.getSlotFor((currentTime + opts.runTimeoutMs) / MS_IN_SEC);
      const epoch = this.clock.getEpochForSlot(slots);
      const slot = this.clock.getSlotIndexInEpoch(slots);

      this.stop(1, `Sim run timedout in ${opts.runTimeoutMs}ms (approx. ${epoch}/${slot}).`).catch((e) =>
        console.error("Error on stop", e)
      );
    }, opts.runTimeoutMs);

    const msToGenesis = this.clock.msToGenesis();
    const startTimeout = setTimeout(() => {
      const slots = this.clock.getSlotFor((currentTime + msToGenesis) / MS_IN_SEC);
      const epoch = this.clock.getEpochForSlot(slots);
      const slot = this.clock.getSlotIndexInEpoch(slots);

      this.stop(
        1,
        `Start sequence not completed before genesis, in ${msToGenesis}ms (approx. ${epoch}/${slot}).`
      ).catch((e) => console.error("Error on stop", e));
    }, msToGenesis);

    try {
      regsiterProcessHandler(this);
      if (!fs.existsSync(this.options.rootDir)) {
        await mkdir(this.options.rootDir);
      }

      await this.runner.start();
      await Promise.all(this.nodes.map((node) => node.el.job.start()));

      await this.initGenesisState();
      if (!this.genesisState) {
        throw new Error("The genesis state for CL clients is not defined.");
      }

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
    await this.runner.stop();

    if (this.tracker.getErrorCount() > 0) {
      this.tracker.reporter.summary();
      process.exit(this.tracker.getErrorCount() > 0 ? 1 : code);
    } else {
      process.exit(code);
    }
  }

  async createNodePair<C extends CLClient, E extends ELClient>({
    el,
    cl,
    keysCount,
    id,
    remote,
    mining,
  }: NodePairOptions<C, E>): Promise<NodePair> {
    if (this.genesisState && keysCount > 0) {
      throw new Error("Genesis state already initialized. Can not add more keys to it.");
    }
    const interopKeys = Array.from({length: keysCount}, (_, vi) => {
      return interopSecretKey(this.keysCount + vi);
    });
    this.keysCount += keysCount;

    const keys: CLClientKeys =
      interopKeys.length > 0 && remote
        ? {type: "remote", secretKeys: interopKeys}
        : interopKeys.length > 0
        ? {type: "local", secretKeys: interopKeys}
        : {type: "no-keys"};

    const elType = typeof el === "object" ? el.type : el;
    const clType = typeof cl === "object" ? cl.type : cl;

    const elOptions = typeof el === "object" ? el.options : {};
    const elNode = await this.createELNode(elType, {...elOptions, id, mining, nodeIndex: this.nodePairCount});

    const clOptions = typeof cl === "object" ? cl.options : {};
    const engineUrls = [
      // As lodestar is running on host machine, need to connect through local exposed ports
      clType === CLClient.Lodestar ? replaceIpFromUrl(elNode.engineRpcUrl, "127.0.0.1") : elNode.engineRpcUrl,
      ...(clOptions.engineUrls || []),
    ];

    const clNode = await this.createCLNode(clType, {
      ...clOptions,
      id,
      keys,
      engineMock: typeof el === "string" ? el === ELClient.Mock : el.type === ELClient.Mock,
      engineUrls,
      nodeIndex: this.nodePairCount,
    });

    this.nodePairCount += 1;

    return {id, el: elNode, cl: clNode};
  }

  private async createCLNode<C extends CLClient>(
    client: C,
    options: AtLeast<CLClientGeneratorOptions<C>, "keys" | "id" | "nodeIndex">
  ): Promise<CLNode> {
    const clId = `${options?.id}-cl-${client}`;

    const clPaths = await createCLNodePaths(
      getCLNodePaths({
        root: this.options.rootDir,
        id: options.id,
        client,
        logsDir: this.options.logsDir,
      })
    );
    await createKeystores(clPaths, options.keys);
    await writeFile(clPaths.jwtsecretFilePath, SHARED_JWT_SECRET);
    await writeFile(clPaths.keystoresSecretFilePath, SHARED_VALIDATOR_PASSWORD);
    if (this.genesisState) {
      await writeFile(clPaths.genesisFilePath, this.genesisState.serialize());
    }

    // We have to wite the geneiss state but can't do that without starting up
    // atleast one EL node and getting ETH_HASH, so will do in startup
    //await writeFile(clPaths.genesisFilePath, this.genesisState);

    const opts: CLClientGeneratorOptions = {
      id: clId,
      config: this.forkConfig,
      paths: clPaths,
      nodeIndex: options.nodeIndex,
      keys: options?.keys ?? {type: "no-keys"},
      genesisTime: this.options.genesisTime,
      engineMock: options?.engineMock ?? false,
      clientOptions: options?.clientOptions ?? {},
      address: "127.0.0.1",
      engineUrls: options?.engineUrls ?? [],
    };

    switch (client) {
      case CLClient.Lodestar: {
        return generateLodestarBeaconNode(
          {
            ...opts,
            address: "127.0.0.1",
            engineUrls: options?.engineUrls
              ? makeUniqueArray([
                  `http://127.0.0.1:${EL_ENGINE_BASE_PORT + this.nodePairCount + 1}`,
                  ...options.engineUrls,
                ])
              : [`http://127.0.0.1:${EL_ENGINE_BASE_PORT + this.nodePairCount + 1}`],
          },
          this.runner
        );
      }
      case CLClient.Lighthouse: {
        return generateLighthouseBeaconNode(
          {
            ...opts,
            address: this.runner.getNextIp(),
            engineUrls: options?.engineUrls
              ? makeUniqueArray([...options.engineUrls])
              : [`http://127.0.0.1:${EL_ENGINE_BASE_PORT + this.nodePairCount + 1}`],
          },
          this.runner
        );
      }
      default:
        throw new Error(`CL Client "${client}" not supported`);
    }
  }

  private async createELNode<E extends ELClient>(
    client: E,
    options: AtLeast<ELGeneratorClientOptions<E>, "id" | "nodeIndex">
  ): Promise<ELNode> {
    const elId = `${options.id}-el-${client}`;

    const elPaths = await createELNodePaths(
      getELNodePaths({
        root: this.options.rootDir,
        id: options.id,
        client,
        logsDir: this.options.logsDir,
      })
    );
    await writeFile(elPaths.jwtsecretFilePath, SHARED_JWT_SECRET);

    const mode =
      options?.mode ?? (this.forkConfig.BELLATRIX_FORK_EPOCH > 0 ? ELStartMode.PreMerge : ELStartMode.PostMerge);

    await writeFile(
      elPaths.genesisFilePath,
      JSON.stringify(
        getGethGenesisBlock(mode, {
          ttd: options?.ttd ?? this.forkConfig.TERMINAL_TOTAL_DIFFICULTY,
          cliqueSealingPeriod: options?.cliqueSealingPeriod ?? CLIQUE_SEALING_PERIOD,
          clientOptions: [],
        })
      )
    );

    const opts: ELGeneratorClientOptions<E> = {
      id: elId,
      paths: elPaths,
      nodeIndex: options.nodeIndex,
      mode: options?.mode ?? (this.forkConfig.BELLATRIX_FORK_EPOCH > 0 ? ELStartMode.PreMerge : ELStartMode.PostMerge),
      ttd: options?.ttd ?? this.forkConfig.TERMINAL_TOTAL_DIFFICULTY,
      cliqueSealingPeriod: options?.cliqueSealingPeriod ?? CLIQUE_SEALING_PERIOD,
      address: this.runner.getNextIp(),
      mining: options?.mining ?? false,
      clientOptions: options.clientOptions ?? [],
    };

    switch (client) {
      case ELClient.Mock: {
        return generateMockNode(opts as ELGeneratorClientOptions<ELClient.Mock>, this.runner);
      }
      case ELClient.Geth: {
        return generateGethNode(opts as ELGeneratorClientOptions<ELClient.Geth>, this.runner);
      }
      case ELClient.Nethermind: {
        return generateNethermindNode(opts as ELGeneratorClientOptions<ELClient.Nethermind>, this.runner);
      }
      default:
        throw new Error(`EL Client "${client}" not supported`);
    }
  }

  private async initGenesisState(): Promise<void> {
    for (let i = 0; i < this.nodes.length; i++) {
      // Get genesis block hash
      const el = this.nodes[i].el;

      // If eth1 is mock then genesis hash would be empty
      const eth1Genesis = el.provider === null ? {hash: MOCK_ETH1_GENESIS_HASH} : await el.provider.getBlockByNumber(0);

      if (!eth1Genesis) {
        throw new Error(`Eth1 genesis not found for node "${this.nodes[i].id}"`);
      }

      const genesisState = nodeUtils.initDevState(this.forkConfig, this.keysCount, {
        genesisTime: this.options.genesisTime,
        eth1BlockHash: fromHexString(eth1Genesis.hash),
      }).state;

      this.genesisState = genesisState;

      // Write the genesis state for all nodes
      for (const node of this.nodes) {
        const {genesisFilePath} = getCLNodePaths({
          root: this.options.rootDir,
          id: node.id,
          logsDir: this.options.logsDir,
          client: node.cl.client,
        });
        await writeFile(genesisFilePath, this.genesisState.serialize());
      }
    }
  }
}
