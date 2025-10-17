import fs from "node:fs";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {getClient} from "@lodestar/api";
import {getClient as keyManagerGetClient} from "@lodestar/api/keymanager";
import {initCKZG, loadEthereumTrustedSetup} from "@lodestar/beacon-node/util";
import {ChainForkConfig} from "@lodestar/config";
import {LogLevel, TimestampFormatCode} from "@lodestar/logger";
import {LoggerNode, getNodeLogger} from "@lodestar/logger/node";
import {activePreset} from "@lodestar/params";
import {prettyMsToTime} from "@lodestar/utils";
import tmp from "tmp";
import {KurtosisSDKRunner} from "../runner/kurtosisSDKRunner.js"; //✅ New Kurtosis Runner
import {KurtosisNetworkConfig, KurtosisServicesMap, NodeService} from "../runner/kurtosisTypes.js";
import {loadKurtosisConfig} from "../runner/loadKurtosisConfig.js";
import {EpochClock, MS_IN_SEC} from "../../epochClock.js";
import {ExternalSignerServer} from "../../externalSignerServer.js";

import {
  BeaconClient,
  BeaconNode,
  ExecutionClient,
  ExecutionNode,
  IRunner,
  NodePair,
  SimulationInitOptions,
  SimulationOptions,
  ValidatorClient,
  ValidatorNode,
} from "../../interfaces.js";
import {SimulationTracker} from "../../simulationTracker.js";
import {registerProcessHandler} from "../../utils/index.js";
import { randomUUID } from "node:crypto";

interface StartOpts {
  runTimeoutMs: number;
}

export class Simulation {
  readonly nodes: NodePair[] = [];
  readonly clock: EpochClock;
  readonly tracker: SimulationTracker;
  runner!: IRunner; // ✅ NEW - Kurtosis-specific
  readonly externalSigner: ExternalSignerServer;
  readonly logger: LoggerNode;
  readonly forkConfig: ChainForkConfig;
  readonly options: SimulationOptions;

  // private nodePairCount = 0;
  //private genesisState?: BeaconStateAllForks;
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
    //env.runner = new KurtosisSDKRunner(`sim-${id}`);
    //await env.runner.start(`sim-${id}`);

    // Start Kurtosis enclave & run the package (unique per run) with dynamic name with timestamp and UUID
    const enclaveName = `enclave-${Date.now()}-${randomUUID().slice(0, 8)}`;

    env.runner = new KurtosisSDKRunner(enclaveName);
    await env.runner.start(enclaveName);

    env.logger.info(`-- Created unique Kurtosis enclave: ${enclaveName}`);

    // Load the YAML → KurtosisNetworkConfig
    const kurtosisConfig = await loadKurtosisConfig(kurtosisConfigPath);
    const services = await env.runner.create(kurtosisConfig);

    // Convert to NodePair structure from Kurtosis services
    env.nodes.push(
      ...(await env.createNodePairsFromKurtosis(services, kurtosisConfig))
    ); // placeholder: mock point for the logic

    return env;
  }

  // Flexible port discovery from Kurtosis service contexts
  // Allows for different port names (http, rpc, http-beacon, http-validator)
  private getPort(service: NodeService, ...names: string[]): number | undefined {
    const ports = service.serviceContext.getPublicPorts();
    for (const n of names) {
      const p = ports.get(n)?.number;
      if (p) return p;
    }
    return undefined;
  }
  
  // Build HTTP URLs for API clients from service ports
  // Standardized URL construction: Converts port numbers to full HTTP URLs
  private httpUrlFrom(service: NodeService): string {
    const p = this.getPort(service, "http", "rpc", "http-beacon", "http-validator");
    if (!p) throw new Error(`No HTTP-like port exposed for service ${service.id}`);
    return `http://localhost:${p}`;
  }

  // Deterministic service pairing for NodePair creation - matched by exact nodeIndex (1,2,3,...)
  private findServiceByNodeIndex(
    services: KurtosisServicesMap,
    role: "beacon" | "execution" | "validator",
    nodeIndex: number
  ): NodeService | undefined {
    return [...services.values()].find(s => s.role === role && s.metadata?.nodeIndex === nodeIndex);
  }


  /**
   * Assertions expect a standardized input format: NodePair[]
   * Goal: Migration affects how NodePair are created, the testing layer (assertions) remains unchanged
   * Goal: Ensure Kurtosis creates NodePair objects with the same structure that Docker creates
   *
   * createNodePairFromKurtosis() emulates createNodePair(): create and return a NodePair
   *
   */

  private async createNodePairsFromKurtosis(
    services: KurtosisServicesMap,
    config: KurtosisNetworkConfig
  ): Promise<NodePair[]> {
    const mapBeacon = (s: string) => s.toLowerCase() === "lighthouse" ? BeaconClient.Lighthouse : BeaconClient.Lodestar;
    const mapExecution = (s: string) => s.toLowerCase() === "nethermind"
      ? ExecutionClient.Nethermind
      : s.toLowerCase() === "mock"
        ? ExecutionClient.Mock
        : ExecutionClient.Geth;

    const nodePairs: NodePair[] = [];
    let globalNodeIndex = 1;

    for (const p of config.participants) {
      const count = p.count ?? 1;
      const beaconType = mapBeacon(p.cl_type);
      const executionType = mapExecution(p.el_type);

      for (let i = 0; i < count; i++) {
        const idx = globalNodeIndex++;            // This is the CL/EL/VC index used by the package
        const id = `node-${idx}`;
        const clSvc = this.findServiceByNodeIndex(services, "beacon", idx);
        const elSvc = this.findServiceByNodeIndex(services, "execution", idx);
        const vcSvc = this.findServiceByNodeIndex(services, "validator", idx);

        // Helpful error with context
        if (!clSvc || !elSvc) {
          const dump = [...services.values()]
            .map(s => `${s.id} role=${s.role} idx=${s.metadata?.nodeIndex}`).join(", ");
          throw new Error(`Missing services for nodeIndex=${idx}: CL=${!!clSvc} EL=${!!elSvc}, services=[${dump}]`);
        }

        const beacon = await this.createBeaconNodeFromKurtosis(clSvc, beaconType);
        const execution = await this.createExecutionNodeFromKurtosis(
          elSvc,
          executionType
        );

        const validator = vcSvc
          ? await this.createValidatorNodeFromKurtosis(vcSvc, beacon, p.vc_extra_params ?? [])
          : undefined;

        nodePairs.push({id, beacon, execution, validator});
      }
    }

    return nodePairs;
  }
  
  // Extract numeric node index from service ID
  /*private extractNodeIndex(serviceId: string): number {
    // Handle patterns like "cl-1", "el-2", "vc-3", "lodestar-1", "geth-2", etc.
    const match = serviceId.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  }*/


  private async createBeaconNodeFromKurtosis(
    service: NodeService,
    beaconType: BeaconClient
  ): Promise<BeaconNode> {
    const restUrl = this.httpUrlFrom(service);
    const api = getClient({baseUrl: restUrl}, {config: this.forkConfig});
  
    return {
      client: beaconType,
      id: `${service.id}-beacon-${beaconType}`,
      restPublicUrl: restUrl,
      restPrivateUrl: restUrl,
      api,
      serviceContext: service.serviceContext,
    };
  }  


  private async createExecutionNodeFromKurtosis(
    service: NodeService,
    executionType: ExecutionClient
  ): Promise<ExecutionNode> {

    // Ports for public and private URLs for the execution node (Kurtosis services)
    const httpPort = this.getPort(service, "rpc", "http");
    const engPort  = this.getPort(service, "engine-rpc", "engine");
    const ethRpcPublicUrl = httpPort ? `http://localhost:${httpPort}` : "";
    const engineRpcPublicUrl = engPort ? `http://localhost:${engPort}` : "";
  
    const provider = executionType === ExecutionClient.Mock ? null : new (await import("web3")).Web3(ethRpcPublicUrl);
    if (provider) {
      const {registerWeb3JsPlugins} = await import("../../web3js/plugins/index.js");
      registerWeb3JsPlugins(provider);
    }
  
    return {
      client: executionType,
      id: `${service.id}-execution-${executionType}`,
      ttd: BigInt(this.forkConfig.TERMINAL_TOTAL_DIFFICULTY),
      engineRpcPublicUrl,
      engineRpcPrivateUrl: engineRpcPublicUrl,
      ethRpcPublicUrl,
      ethRpcPrivateUrl: ethRpcPublicUrl,
      jwtSecretHex: undefined, //Lodestar uses 'SHARED_JWT_SECRET', ethereum-package is hardcoded, 
      provider,
      serviceContext: service.serviceContext,
    };
  }

  private async createValidatorNodeFromKurtosis(
    service: NodeService,
    beacon: BeaconNode,
    vcExtraParams: string[]
  ): Promise<ValidatorNode> {
    
    // Preferred: dedicated Key Manager HTTP on the VC (kurtosis: "http-validator")
    const httpValidatorPort = this.getPort(service, "http-validator");
    const httpPort = this.getPort(service, "http");

    let kmBaseUrl: string | undefined;
    if (httpValidatorPort) {
      kmBaseUrl = `http://localhost:${httpValidatorPort}`;
    } else if (httpPort) {
      // Some packages may still expose VC HTTP as "http"
      this.logger?.warn?.(
        `[${service.id}] no 'http-validator' port; using generic 'http' port for Key Manager`
      );
      kmBaseUrl = `http://localhost:${httpPort}`;
    } else if (beacon.restPublicUrl) {
      // Key Manager is often exposedon the beacon REST when VC HTTP is not published (Fallback solution)
      this.logger?.warn?.(
        `[${service.id}] no VC HTTP exposed; falling back to beacon REST for Key Manager: ${beacon.restPublicUrl}`
      );
      kmBaseUrl = beacon.restPublicUrl;
    }

    if (!kmBaseUrl) {
      throw new Error(
        `Validator ${service.id} has no 'http-validator' or 'http' port and beacon has no REST URL. ` +
        `Expose 'http-validator' on the VC or enable Key Manager on the beacon REST.`
      );
    }
  
    if (vcExtraParams.length > 0) {
      this.logger.info(`VC ${service.id} extra params: ${vcExtraParams.join(" ")}`);
    }
  
    return {
      client: beacon.client === BeaconClient.Lighthouse ? ValidatorClient.Lighthouse : ValidatorClient.Lodestar,
      id: `${service.id}-validator`,
      keyManager: keyManagerGetClient({baseUrl: kmBaseUrl}, {config: this.forkConfig}),
      keys: {type: "no-keys"},
      serviceContext: service.serviceContext,
    };
  }

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

      // Ensure all beacon nodes reach genesis and are health-ready before proceeding 
      // This avoids failures in subsequent operations like validator key imports and tracker start
      this.logger.info("Initializing genesis state for beacon nodes");
      await this.waitForBeaconGenesis({timeoutMs: Math.max(60_000, msToGenesis + 30_000)});

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
    await this.externalSigner.stop();
    await this.runner.stop(); //TODO: is this runner.stop() needed?
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

  /* Simple waitForBeaconGenesis function for Kurtosis simulation -> First version (simple, per-node, sequential)
  private async waitForBeaconGenesis({timeoutMs}: {timeoutMs: number}): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    
    for (const n of this.nodes) {
      const base = n.beacon.restPublicUrl;
      // optional log
      //[this.logger.info](http://this.logger.info/)(`Waiting for beacon genesis at ${base} ...`);
      
      // use existing api client
      while(true) {
        try {
          const res = await n.beacon.api.beacon.getGenesis();
          // a successful response means genesis is ready
          this.logger.info(`Beacon ready: ${n.id} genesis_time=${res.value().genesisTime}`);
          break;
        } catch (e) {
          if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for beacon genesis at ${base}: ${(e as Error).message}`);
          }
          await new Promise(r => setTimeout(r, intervalMs));
        }
      }
    }
  }
  */

  // More complex waitForBeaconGenesis function for Kurtosis simulation -> Second version (parallel, all beacons)
  private async waitForBeaconGenesis({timeoutMs}: {timeoutMs: number}) {
    const deadline = Date.now() + timeoutMs;
    const poll = async (fn: () => Promise<boolean>, label: string, everyMs = 1000) => {
      while (true) {
        try {
          if (await fn()) return;
        } catch {}
        if (Date.now() > deadline) throw new Error(`Timeout waiting for ${label}`);
        await new Promise((r) => setTimeout(r, everyMs));
      }
    };

    // All beacons respond to /genesis
    await Promise.all(
      this.nodes.map((n) =>
        poll(async () => {
          const res = await n.beacon.api.beacon.getGenesis(); // Wait for genesis endpoint to respond
          return !!res.value()?.genesisTime;
        }, `${n.id} /genesis`)
      )
    );

    // Health is SYNCING or READY
    await Promise.all(
      this.nodes.map((n) =>
        poll(async () => {
          const {status} = await n.beacon.api.node.getHealth();
          return status === 200 || status === 206;
        }, `${n.id} health`)
      )
    );
  }

}
