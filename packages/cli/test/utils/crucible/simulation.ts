import fs from "node:fs";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {initCKZG, loadEthereumTrustedSetup} from "@lodestar/beacon-node/util";
import {ChainForkConfig} from "@lodestar/config";
import {LogLevel, TimestampFormatCode} from "@lodestar/logger";
import {LoggerNode, getNodeLogger} from "@lodestar/logger/node";
import {activePreset} from "@lodestar/params";
import {interopSecretKey} from "@lodestar/state-transition";
import {prettyMsToTime} from "@lodestar/utils";
import tmp from "tmp";
import {createBeaconNode} from "./clients/beacon/index.js";
import {createExecutionNode} from "./clients/execution/index.js";
import {createValidatorNode, getValidatorForBeaconNode} from "./clients/validator/index.js";
import {EpochClock, MS_IN_SEC} from "./epochClock.js";
import {ExternalSignerServer} from "./externalSignerServer.js";
import {
  BeaconClient,
  ExecutionClient,
  GeneratorOptions,
  GenesisInfo,
  IRunner,
  NodePair,
  NodePairDefinition,
  SimulationInitOptions,
  SimulationOptions,
  ValidatorClient,
  ValidatorClientKeys,
} from "./interfaces.js";
import {Runner} from "./runner/index.js";
import {SimulationTracker} from "./simulationTracker.js";
import {generateGenesisData} from "./utils/genesis.js";
import {registerProcessHandler, replaceIpFromUrl} from "./utils/index.js";

interface StartOpts {
  runTimeoutMs: number;
}

export class Simulation {
  readonly nodes: NodePair[] = [];
  readonly clock: EpochClock;
  readonly tracker: SimulationTracker;
  readonly runner: IRunner;
  readonly externalSigner: ExternalSignerServer;
  readonly logger: LoggerNode;
  readonly id: string;
  readonly rootDir: string;
  readonly logsDir: string;
  readonly controller: AbortController;
  readonly forkConfig: ChainForkConfig;

  private keysCount = 0;
  private nodePairCount = 0;
  private runTimeout?: NodeJS.Timeout;
  private genesisInfo: GenesisInfo;
  private trustedSetup?: boolean;

  private constructor(options: SimulationOptions) {
    this.id = options.id;
    this.rootDir = options.rootDir;
    this.logsDir = options.logsDir;
    this.forkConfig = options.forkConfig;
    this.logger = options.logger;
    this.genesisInfo = options.genesisInfo;
    this.controller = options.controller;
    this.trustedSetup = options.trustedSetup;
    this.runner = options.runner;

    this.clock = new EpochClock({
      genesisTime: options.genesisInfo.genesisTime,
      secondsPerSlot: this.forkConfig.SECONDS_PER_SLOT,
      slotsPerEpoch: activePreset.SLOTS_PER_EPOCH,
      signal: this.controller.signal,
    });

    this.externalSigner = new ExternalSignerServer([]);
    this.tracker = SimulationTracker.initWithDefaults({
      logsDir: options.logsDir,
      logger: this.logger,
      nodes: [],
      config: this.forkConfig,
      clock: this.clock,
      signal: this.controller.signal,
    });
  }

  static async initWithDefaults(
    {forkConfig, logsDir, id, trustedSetup, logLevel}: SimulationInitOptions,
    clients: NodePairDefinition[]
  ): Promise<Simulation> {
    const logger = getNodeLogger({
      level: LogLevel.debug,
      module: `sim-${id}`,
      timestampFormat: {
        format: TimestampFormatCode.DateRegular,
      },
      file: {
        level: logLevel ?? LogLevel.debug,
        filepath: path.join(logsDir, `simulation-${id}.log`),
      },
    });

    const runner = new Runner({logger});

    logger.info("Generating genesis bootstrap files");

    const rootDir = path.join(tmp.dirSync({unsafeCleanup: true, tmpdir: "/tmp", template: "sim-XXXXXX"}).name, id);
    const genesisTime = Math.floor(Date.now() / 1000);

    const genesisInfo = await generateGenesisData(
      runner,
      {...forkConfig, genesisTime: genesisTime},
      path.join(rootDir, "genesis")
    );

    const env = new Simulation({
      runner,
      forkConfig,
      logsDir,
      id,
      genesisInfo,
      controller: new AbortController(),
      trustedSetup,
      rootDir,
      logger,
    });

    for (const client of clients) {
      env.nodes.push(await env.createNodePair(client));
    }

    return env;
  }

  async start(opts: StartOpts): Promise<void> {
    const currentTime = Date.now();
    this.logger.info(
      `Starting simulation environment "${this.id}". currentTime=${new Date(
        currentTime
      ).toISOString()} simulationTimeout=${prettyMsToTime(opts.runTimeoutMs)} rootDir=${this.rootDir}`
    );

    if (this.trustedSetup) {
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
      if (!fs.existsSync(this.rootDir)) {
        await mkdir(this.rootDir);
      }

      this.logger.info("Starting the simulation runner");
      await this.runner.start();

      this.logger.info("Starting execution nodes");
      await Promise.all(this.nodes.map((node) => node.execution.job.start()));

      this.logger.info("Starting beacon nodes");
      await Promise.all(this.nodes.map((node) => node.beacon.job.start()));

      this.logger.info("Starting validators");
      await Promise.all(this.nodes.map((node) => node.validator?.job.start()));

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
    this.logger.info(`Simulation environment "${this.id}" is stopping: ${message}`);
    await this.tracker.stop({dumpStores: true});
    await Promise.all(this.nodes.map((node) => node.validator?.job.stop()));
    await Promise.all(this.nodes.map((node) => node.beacon.job.stop()));
    await Promise.all(this.nodes.map((node) => node.execution.job.stop()));
    await this.externalSigner.stop();
    await this.runner.stop();
    this.controller.abort();

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

  async createNodePair<B extends BeaconClient, V extends ValidatorClient, E extends ExecutionClient>({
    execution,
    beacon,
    validator,
    keysCount,
    id,
    remote,
    mining,
  }: NodePairDefinition<B, E, V>): Promise<NodePair> {
    if (!this.genesisInfo) {
      throw new Error("No genesis info created");
    }

    if (this.genesisInfo && keysCount > 0) {
      throw new Error("Genesis state already initialized. Can not add more keys to it.");
    }
    const interopKeys = Array.from({length: keysCount}, (_, vi) => {
      return interopSecretKey(this.keysCount + vi);
    });
    this.keysCount += keysCount;

    const keys: ValidatorClientKeys =
      interopKeys.length > 0 && remote
        ? {type: "remote", secretKeys: interopKeys}
        : interopKeys.length > 0
          ? {type: "local", secretKeys: interopKeys}
          : {type: "no-keys"};

    const commonOptions: GeneratorOptions = {
      id,
      nodeIndex: this.nodePairCount,
      forkConfig: this.forkConfig,
      runner: this.runner,
      address: "0.0.0.0",
      genesisInfo: this.genesisInfo,
      rootDir: this.rootDir,
      logsDir: this.logsDir,
    };

    // Execution Node
    const executionType = typeof execution === "object" ? execution.type : execution;
    const executionOptions = typeof execution === "object" ? execution.options : {};
    const executionNode = await createExecutionNode(executionType, {
      ...executionOptions,
      ...commonOptions,
      clientOptions: executionOptions.clientOptions,
      mining,
    });

    // Beacon Node
    const beaconType = typeof beacon === "object" ? beacon.type : beacon;
    const beaconOptions = typeof beacon === "object" ? beacon.options : {};
    const engineUrls = [
      // As lodestar is running on host machine, need to connect through local exposed ports
      beaconType === BeaconClient.Lodestar ? executionNode.engineRpcPublicUrl : executionNode.engineRpcPrivateUrl,
      ...(beaconOptions?.engineUrls ?? []),
    ];
    const beaconNode = await createBeaconNode(beaconType, {
      ...beaconOptions,
      ...commonOptions,
      engineUrls,
    });

    if (keys.type === "no-keys") {
      this.nodePairCount += 1;
      return {id, execution: executionNode, beacon: beaconNode};
    }

    // If no validator configuration is specified we will consider that beacon type is also same as validator type
    const validatorType =
      typeof validator === "object"
        ? validator.type
        : validator === undefined
          ? getValidatorForBeaconNode(beaconType)
          : validator;
    const validatorOptions = typeof validator === "object" ? validator.options : {};
    const beaconUrls = [
      // As lodestar is running on host machine, need to connect through docker named host
      beaconType === BeaconClient.Lodestar && validatorType !== ValidatorClient.Lodestar
        ? replaceIpFromUrl(beaconNode.restPrivateUrl, "host.docker.internal")
        : beaconNode.restPrivateUrl,
      ...(validatorOptions?.beaconUrls ?? []),
    ];

    const validatorNode = await createValidatorNode(validatorType, {
      ...validatorOptions,
      ...commonOptions,
      keys,
      beaconUrls,
    });

    this.nodePairCount += 1;

    return {id, execution: executionNode, beacon: beaconNode, validator: validatorNode};
  }
}
