import fs from "node:fs";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {fromHexString} from "@chainsafe/ssz";
import {getClient} from "@lodestar/api";
import {BeaconNode, nodeUtils} from "@lodestar/beacon-node";
import {initCKZG, loadEthereumTrustedSetup} from "@lodestar/beacon-node/util";
import {ChainForkConfig} from "@lodestar/config";
import {LogLevel, TimestampFormatCode} from "@lodestar/logger";
import {LoggerNode, getNodeLogger} from "@lodestar/logger/node";
import {activePreset} from "@lodestar/params";
import {BeaconStateAllForks, interopSecretKey} from "@lodestar/state-transition";
import {prettyMsToTime} from "@lodestar/utils";
import tmp from "tmp";
import {KurtosisSDKRunner} from "../runner/kurtosisSDKRunner.js"; //✅ New Kurtosis Runner
import {KurtosisNetworkConfig, KurtosisServicesMap, NodeService} from "../runner/kurtosisTypes.js";
import {loadKurtosisConfig} from "../runner/loadKurtosisConfig.js";
//import {createBeaconNode} from "./clients/beacon/index.js"; //❌ To be removed
//import {createExecutionNode} from "./clients/execution/index.js"; //❌ To be removed
//import {createValidatorNode, getValidatorForBeaconNode} from "./clients/validator/index.js"; //❌ To be removed
import {MOCK_ETH1_GENESIS_HASH} from "../../constants.js";
import {EpochClock, MS_IN_SEC} from "../../epochClock.js";
import {ExternalSignerServer} from "../../externalSignerServer.js";
import {
  BeaconClient,
  ExecutionClient,
  GeneratorOptions,
  IRunner,
  NodePair,
  NodePairDefinition,
  SimulationInitOptions,
  SimulationOptions,
  ValidatorClient,
  ValidatorClientKeys,
} from "../../interfaces.js";
// import {Runner} from "./runner/index.js"; //❌ To be removed
import {SimulationTracker} from "../../simulationTracker.js";
import {registerProcessHandler, replaceIpFromUrl} from "../../utils/index.js";
import {getNodePaths} from "../../utils/paths.js";

interface StartOpts {
  runTimeoutMs: number;
}

export class Simulation {
  readonly nodes: NodePair[] = [];
  readonly clock: EpochClock;
  readonly tracker: SimulationTracker;
  readonly runner!: IRunner; // ✅ NEW - Kurtosis-specific
  readonly externalSigner: ExternalSignerServer;
  readonly logger: LoggerNode;
  readonly forkConfig: ChainForkConfig;
  readonly options: SimulationOptions;

  private keysCount = 0;
  private nodePairCount = 0;
  private genesisState?: BeaconStateAllForks;
  private runTimeout?: NodeJS.Timeout;

  private constructor(forkConfig: ChainForkConfig, options: SimulationOptions) {
    this.forkConfig = forkConfig;
    this.options = options;

    this.logger = getNodeLogger({
      level: LogLevel.debug,
      module: `sim-${this.options.id}`,
      timestampFormat: {
        format: TimestampFormatCode.DateRegular,
      },
      file: {
        level: options.logLevel ?? LogLevel.debug,
        filepath: path.join(options.logsDir, `simulation-${this.options.id}.log`),
      },
    });
    this.clock = new EpochClock({
      genesisTime: this.options.genesisTime + this.forkConfig.GENESIS_DELAY,
      secondsPerSlot: this.forkConfig.SECONDS_PER_SLOT,
      slotsPerEpoch: activePreset.SLOTS_PER_EPOCH,
      signal: this.options.controller.signal,
    });

    this.externalSigner = new ExternalSignerServer([]);
    //this.runner = new Runner({logger: this.logger}); //❌ REMOVE - Docker-specific
    //this.runner = new KurtosisSDKRunner(`sim-${this.options.id}`); // ✅ NEW - Kurtosis-specific if "readonly runner!: IRunner;" is not the most optimal solution 
    this.tracker = SimulationTracker.initWithDefaults({
      //🔄 Refactored for Kurtosis?
      logsDir: options.logsDir,
      logger: this.logger,
      nodes: [],
      config: this.forkConfig,
      clock: this.clock,
      signal: this.options.controller.signal,
    });
  }

  /*static async initWithDefaults(
    {forkConfig, logsDir, id, trustedSetup}: SimulationInitOptions,
    clients: NodePairDefinition[]
  ): Promise<Simulation> {
    const env = new Simulation(forkConfig, {
      logsDir,
      id,
      genesisTime: Math.floor(Date.now() / 1000),
      controller: new AbortController(),
      trustedSetup,
      rootDir: path.join(tmp.dirSync({unsafeCleanup: true, tmpdir: "/tmp", template: "sim-XXXXXX"}).name, id),
    });

    for (const client of clients) {
      env.nodes.push(await env.createNodePair(client));
    }

    return env;
  }*/

  /**
   * ===================== Kurtosis Integration =====================
   *
   * Handles the conversion between Kurtosis execution environments and the node system
   *
   * Core Responsibility:
   *  - Acts as an adapter that allows the current testing framework to run simulations using Kurtosis
   *  - Convert Kurtosis services to Crucible-compatible nodes
   *  - Map to Crucible network configuration
   *  - Maintain existing simulation lifecycle
   *
   */

  // NEW - Kurtosis initWithKurtosisConfig()
  static async initWithKurtosisConfig(
    {forkConfig, logsDir, id, trustedSetup}: SimulationInitOptions,
    kurtosisConfigPath: string // Path to .yaml config file
  ): Promise<Simulation> {
    const env = new Simulation(forkConfig, {
      logsDir,
      id,
      genesisTime: Math.floor(Date.now() / 1000),
      controller: new AbortController(),
      trustedSetup,
      rootDir: path.join(tmp.dirSync({unsafeCleanup: true, tmpdir: "/tmp", template: "sim-XXXXXX"}).name, id),
    });

    // Start Kurtosis enclave & run the package
    env.runner = new KurtosisSDKRunner(`sim-${id}`);
    await env.runner.start(`sim-${id}`);

    // Load the YAML → KurtosisNetworkConfig
    const kurtosisConfig = await loadKurtosisConfig(kurtosisConfigPath);
    const services = await env.runner.create(kurtosisConfig);

    // Convert to NodePair structure from Kurtosis services
    env.nodes = await env.createNodePairsFromKurtosis(services, kurtosisConfig); // placeholder: mock point for the logic

    return env;
  }

  /**
   * Assertions expect a standardized input format: NodePair[]
   * Goal: Migration affects how NodePair are created, the testing layer (assertions) remains unchanged
   * Goal: Ensure Kurtosis creates NodePair objects with the same structure that Docker creates
   *
   * createNodePairFromKurtosis() emulates createNodePair(): create and return a NodePair
   * NodePair has Docker Job reference, with migration Job will be substituted with a Kurtosis-native ServiceContext
   *
   */

  private async createNodePairsFromKurtosis(
    // Iterates over participants in the config
    services: KurtosisServicesMap,
    config: KurtosisNetworkConfig
  ): Promise<NodePair[]> {
    const nodePairs: NodePair[] = [];

    const participantCount = config.participants.reduce((total: number, participant: {count?: number}) => {
      // iterates over all the participants and sum their count
      return total + (participant.count || 1);
    }, 0);

    for (let i = 0; i < participantCount; i++) {
      const nodeId = `node-${i + 1}`;
      // Converts Kurtosis services to Crucible NodePair[]
      const nodePair = await this.createNodePairFromKurtosis(nodeId, services, config, i); //Placeholder for the NodePair creation
      nodePairs.push(nodePair);
    }

    return nodePairs;
  }

  private async createNodePairFromKurtosis(
    nodeId: string,
    services: KurtosisServicesMap,
    config: KurtosisNetworkConfig,
    nodeIndex: number
  ): Promise<NodePair> {
    const forkConfig = this.forkConfig; //🔄 TODO: check if forkConfig is necessary for the NodePair creation

    // Kurtosis naming convention: beacon (CL) services are prefixed with "cl-", execution (EL) with "el-", validator (VC) with "vc-"
    //🔄 TODO: check correctness of nomenclature and returned object
    const beaconService = [...services.keys()].filter((n) => n.startsWith("cl-"));
    const executionService = [...services.keys()].filter((n) => n.startsWith("el-"));
    const validatorService = [...services.keys()].filter((n) => n.startsWith("vc-"));

    if (!beaconService || !executionService) {
      throw new Error(`Required services not found for node ${nodeId}`);
    }

    // Placeholder for the NodePair creation
    return {
      id: nodeId,
      beacon: await this.createBeaconNodeFromKurtosis(beaconService, config, nodeIndex, forkConfig), //🔄 TODO: check input parameters for beaconNode creation
      execution: await this.createExecutionNodeFromKurtosis(executionService, config, nodeIndex, forkConfig), //🔄 TODO: check input parameters for executionNode creation
      validator: validatorService
        ? await this.createValidatorNodeFromKurtosis(validatorService, config, nodeIndex, forkConfig)
        : undefined, //🔄 TODO: check input parameters for validatorNode creation
    };
  }

  // 🔄 Initial logic draft: Convert Kurtosis NodeService to Beacon/Execution/ValidatorNode
  /**
   * - Create BeaconNode/ExecutionNode from Kurtosis NodeService
   * - Use Kurtosis public URLs for API calls
   * - Use forkConfig for API client configuration
   * - Return BeaconNode/ExecutionNode with API client
   *
   * Example signatures:
   * 1. Basic
   * function createBeaconNodeFromKurtosis(service: NodeService): BeaconNode
   *
   * 2. & 3. With Config and Context
   * this.createBeaconNodeFromKurtosis(beaconService, config, nodeIndex)
   * this.createBeaconNodeFromKurtosis(beaconService, config, nodeIndex, forkConfig)  // Most complete
   *
   * 4. Simplified Index
   * this.createBeaconNodeFromKurtosis(beaconService, config, i)
   *
   */

  //🔄 Initial logic draft: Create BeaconNode with Kurtosis service context
  private async createBeaconNodeFromKurtosis(
    beaconService: NodeService,
    _config: KurtosisNetworkConfig,
    _nodeIndex: number,
    forkConfig: ChainForkConfig
  ): Promise<BeaconNode> {
    // 🔄 Recreate the API client with Kurtosis URL
    const api = getClient(
      {baseUrl: beaconService.apiUrl || ""},
      {config: forkConfig} // Same forkConfig
    );

    //Placeholder for the BeaconNode creation
    return {
      client: BeaconClient.Lodestar,
      id: `${beaconService.id}-beacon-lodestar`,
      restPublicUrl: beaconService.apiUrl || "",
      restPrivateUrl: beaconService.apiUrl || "",
      // TODO: implement real Kurtosis API call
      api, //🔄 Placeholder: returning mock api for now
    };
  }

  /*
  private async createExecutionNodeFromKurtosis(
    beaconService: NodeService,
    config: KurtosisNetworkConfig,
    nodeIndex: number,
    forkConfig: ChainForkConfig
  ): Promise<ExecutionNode> {}
  */

  /*
  private async createValidatorNodeFromKurtosis(
    validatorService: NodeService,
    config: KurtosisNetworkConfig,
    nodeIndex: number,
    forkConfig: ChainForkConfig
  ): Promise<ValidatorNode> {}
  */

  async start(opts: StartOpts): Promise<void> {
    const currentTime = Date.now();
    this.logger.info(
      `Starting simulation environment "${this.options.id}". currentTime=${new Date(
        currentTime
      ).toISOString()} simulationTimeout=${prettyMsToTime(opts.runTimeoutMs)} rootDir=${this.options.rootDir}`
    );

    if (this.options.trustedSetup) {
      await initCKZG();
      loadEthereumTrustedSetup();
    }

    if (opts.runTimeoutMs > 0) {
      this.runTimeout = setTimeout(() => {
        const slots = this.clock.getSlotFor((currentTime + opts.runTimeoutMs) / MS_IN_SEC);
        const epoch = this.clock.getEpochForSlot(slots);
        const slot = this.clock.getSlotIndexInEpoch(slots);

        this.stop(1, `Sim run timeout in ${opts.runTimeoutMs}ms (approx. ${epoch}/${slot}).`).catch((e) =>
          this.logger.error("Error on stop", e)
        );
      }, opts.runTimeoutMs);
    }

    const msToGenesis = this.clock.msToGenesis();
    const startTimeout = setTimeout(() => {
      const slots = this.clock.getSlotFor((currentTime + msToGenesis) / MS_IN_SEC);
      const epoch = this.clock.getEpochForSlot(slots);
      const slot = this.clock.getSlotIndexInEpoch(slots);

      this.stop(
        1,
        `Start sequence not completed before genesis, in ${prettyMsToTime(msToGenesis)} (approx. ${epoch}/${slot}).`
      ).catch((e) => this.logger.error("Error on stop", e));
    }, msToGenesis);

    try {
      registerProcessHandler(this);
      if (!fs.existsSync(this.options.rootDir)) {
        await mkdir(this.options.rootDir);
      }

      this.logger.info("Starting the simulation runner");
      await this.runner.start(`sim-${this.options.id}`);

      this.logger.info("Starting execution nodes");
      await Promise.all(this.nodes.map((node) => node.execution.job.start())); //REMOVE - Docker-specific

      this.logger.info("Initializing genesis state for beacon nodes");
      await this.initGenesisState();
      if (!this.genesisState) {
        throw new Error("The genesis state for CL clients is not defined.");
      }

      this.logger.info("Starting beacon nodes");
      await Promise.all(this.nodes.map((node) => node.beacon.job.start())); //❌ REMOVE - Docker-specific

      this.logger.info("Starting validators");
      await Promise.all(this.nodes.map((node) => node.validator?.job.start())); //❌ REMOVE - Docker-specific

      if (this.nodes.some((node) => node.validator?.keys.type === "remote")) {
        this.logger.info("Starting external signer");
        await this.externalSigner.start();

        for (const node of this.nodes) {
          if (node.validator?.keys.type === "remote") {
            this.externalSigner.addKeys(node.validator?.keys.secretKeys);
            await node.validator.keyManager.importRemoteKeys({
              remoteSigners: node.validator.keys.secretKeys.map((sk) => ({
                pubkey: sk.toPublicKey().toHex(),
                url: this.externalSigner.url,
              })),
            });
            this.logger.info(`Imported remote keys for node ${node.id}`);
          }
        }
      }

      this.logger.info("Starting the simulation tracker");
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
    this.logger.info(`Simulation environment "${this.options.id}" is stopping: ${message}`);
    await this.tracker.stop({dumpStores: true});
    await Promise.all(this.nodes.map((node) => node.validator?.job.stop())); //❌ REMOVE - Docker-specific
    await Promise.all(this.nodes.map((node) => node.beacon.job.stop())); //❌ REMOVE - Docker-specific
    await Promise.all(this.nodes.map((node) => node.execution.job.stop())); //❌ REMOVE - Docker-specific
    await this.externalSigner.stop();
    await this.runner.stop(); //❌ REMOVE - Docker-specific
    this.options.controller.abort();

    if (this.runTimeout) {
      clearTimeout(this.runTimeout);
    }

    if (this.tracker.getErrorCount() > 0) {
      this.tracker.reporter.summary();
      process.exit(this.tracker.getErrorCount() > 0 ? 1 : code);
    } else {
      process.exit(code);
    }
  }


  private async initGenesisState(): Promise<void> {
    for (let i = 0; i < this.nodes.length; i++) {
      // Get genesis block hash
      const el = this.nodes[i].execution;

      // If eth1 is mock then genesis hash would be empty
      const eth1Genesis = el.provider === null ? {hash: MOCK_ETH1_GENESIS_HASH} : await el.provider?.eth.getBlock(0);

      if (!eth1Genesis.hash) {
        throw new Error(`Eth1 genesis not found for node "${this.nodes[i].id}"`);
      }

      const genesisState = nodeUtils.initDevState(this.forkConfig, this.keysCount, {
        genesisTime: this.options.genesisTime + this.forkConfig.GENESIS_DELAY,
        eth1BlockHash: fromHexString(eth1Genesis.hash),
        withEth1Credentials: true,
      }).state;

      this.genesisState = genesisState;

      // Write the genesis state for all nodes
      for (const node of this.nodes) {
        const {genesisFilePath} = getNodePaths({
          root: this.options.rootDir,
          id: node.id,
          logsDir: this.options.logsDir,
          client: node.beacon.client,
        });
        await writeFile(genesisFilePath, this.genesisState.serialize());
      }
    }
  }
}
