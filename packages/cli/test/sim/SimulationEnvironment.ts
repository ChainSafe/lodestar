import fs from "node:fs";
import path from "node:path";
import child_process from "node:child_process";
import {promisify} from "node:util";
import tmp from "tmp";
import yaml from "js-yaml";
import fetch from "cross-fetch";
import type {SecretKey} from "@chainsafe/bls/types";
import {Keystore} from "@chainsafe/bls-keystore";
import {retry, toHex} from "@lodestar/utils";
import {Epoch} from "@lodestar/types";
import {PresetName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {nodeUtils} from "@lodestar/beacon-node/node";
import {chainConfigToJson, createIChainForkConfig, IChainConfig, IChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {Api, getClient, routes} from "@lodestar/api/beacon";
import {getClient as getClientKeymanager} from "@lodestar/api/keymanager";
import {BeaconStateAllForks, interopSecretKey} from "@lodestar/state-transition";
import {getLocalAddress} from "./utils/address.js";
import {formatEpochSlotTime} from "./utils/timeLogGenesis.js";
import {Eth2Client, LocalKeystores, RemoteKeys, SpwanOpts, SubprocessForever} from "./eth2clients/interface.js";
import {prepareBeaconNodeArgs, prepareClient, prepareValidatorArgs} from "./eth2clients/index.js";
import {prepareInMemoryWeb3signer} from "./externalSigners/inMemory.js";
import {NetworkData} from "./SimulationTracker.js";

const BN_P2P_BASE_PORT = 9000;
const BN_REST_BASE_PORT = 4000;
const VC_KEYMANAGER_BASE_PORT = 6000;
const EXTERNAL_SIGNER_BASE_PORT = 7000;
const MAX_STD_BUFFERED = 10_000;

/** Time it takes for Lodestar pre-built CLI to start-up and decrypt keys */
const LODESTAR_STARTUP_TIME = parseInt(process.env.SIMTEST_LODESTAR_STARTUP_TIME ?? "") || 30;

export type SimulationEnvironmentOpts = {
  runId: string;
  beaconNodes: BeaconNodeOpts[];
  chainConfig: Partial<IChainConfig>;
  logFilesDir: string;
  preset: PresetName;
};

export type BeaconNodeOpts = {
  client: Eth2Client;
  /** Set to 0 to not run any validator client */
  validatorClients: number;
  keysPerValidatorClient: number;
  useExternalSigner: boolean;
};

interface BeaconNodeData {
  processId: string;
  process: null | SubprocessForever;
  nodeIndex: number;
  p2pPort: number;
  restPort: number;
  client: Eth2Client;
}

interface ValidatorClientData {
  processId: string;
  process: null | SubprocessForever;
  vcIndex: number;
  keymanagerPort: number;
  beaconUrl: string;
  signer: LocalKeystores | RemoteKeys;
  client: Eth2Client;
}

interface ExternalSignerData {
  processId: string;
  process: null | SubprocessForever;
  port: number;
  signer: LocalKeystores;
}

/* eslint-disable no-console */

/**
 * Entrypoint class to run a small local network for some epochs and run assertions.
 */
export class SimulationEnvironment {
  // Genesis data
  private readonly validatorCount: number;
  private readonly genesisTime: number;
  private readonly genesisState: BeaconStateAllForks;
  private readonly config: IChainForkConfig;

  // Sim data
  private readonly simDir: string;
  private readonly pipeLogsToStd = Boolean(process.env.SIMTEST_PIPE_LOGS_TO_STD);

  constructor(
    private readonly params: SimulationEnvironmentOpts,
    readonly beaconNodes: BeaconNodeData[],
    readonly validators: ValidatorClientData[],
    readonly externalSigners: ExternalSignerData[]
  ) {
    // Apply defaults first
    this.config = createIChainForkConfig({...chainConfig, ...params.chainConfig});
    this.validatorCount = getTotalValidatorCount(params.beaconNodes);
    const genesisDelaySec = getGenesisDelaySec(params.beaconNodes);
    this.genesisTime = Math.floor(Date.now() / 1000) + genesisDelaySec;
    this.genesisState = nodeUtils.initDevState(this.config, this.validatorCount, {genesisTime: this.genesisTime}).state;
    this.simDir = path.join(tmp.dirSync({unsafeCleanup: true}).name, params.runId);
  }

  static async fromParams(params: SimulationEnvironmentOpts): Promise<SimulationEnvironment> {
    const beaconNodes: BeaconNodeData[] = [];
    const validators: ValidatorClientData[] = [];
    const externalSigners: ExternalSignerData[] = [];
    const clients = new Set<Eth2Client>();

    let startKeyIndex = 0;
    let vcIndexOffset = 0;

    // Start the beacon node processes
    for (const [nodeIndex, beaconNode] of params.beaconNodes.entries()) {
      clients.add(beaconNode.client);
      const p2pPort = BN_P2P_BASE_PORT + nodeIndex;
      const restPort = BN_REST_BASE_PORT + nodeIndex;
      const beaconUrl = getLocalAddress(restPort);

      beaconNodes.push({
        processId: `node-${nodeIndex}`,
        process: null,
        nodeIndex: nodeIndex,
        p2pPort,
        restPort,
        client: beaconNode.client,
      });

      for (let vcIndex = 0; vcIndex < beaconNode.validatorClients; vcIndex++) {
        const secretKeys = deriveSecretKeys(startKeyIndex, beaconNode.keysPerValidatorClient);
        const publicKeys = secretKeys.map((sk) => sk.toPublicKey().toHex());
        const vcKeymanagerPort = VC_KEYMANAGER_BASE_PORT + vcIndexOffset;
        const externalSignerPort = EXTERNAL_SIGNER_BASE_PORT + vcIndexOffset;

        console.log(params.runId, `Generating keystores for vc ${nodeIndex}-${vcIndex}`);
        const localSigner = await generateKeystores(secretKeys);

        validators.push({
          processId: `vc-${nodeIndex}-${vcIndex}`,
          process: null,
          vcIndex,
          keymanagerPort: vcKeymanagerPort,
          beaconUrl,
          signer: beaconNode.useExternalSigner
            ? {useExternalSigner: true, keymanagerUrl: getLocalAddress(externalSignerPort), publicKeys}
            : localSigner,
          client: beaconNode.client,
        });

        if (beaconNode.useExternalSigner) {
          externalSigners.push({
            processId: `ex-${nodeIndex}-${vcIndex}`,
            process: null,
            port: externalSignerPort,
            signer: localSigner,
          });
        }

        startKeyIndex += beaconNode.keysPerValidatorClient;
        vcIndexOffset += 1;
      }
    }

    // Run any requisites before setting a genesis date; i.e. pulling docker image
    for (const client of clients) {
      console.log(params.runId, `Preparing client ${client}`);
      await prepareClient({client});
    }

    return new SimulationEnvironment(params, beaconNodes, validators, externalSigners);
  }

  async start(onError: OnError): Promise<void> {
    // Print logDir so local debuggers can `tail -f` files to debug ongoing tests
    const logDir = this.params.logFilesDir;
    this.log(`Starting logDir ${logDir} simDir ${this.simDir}`);

    // Remove dir if existing
    fs.rmSync(logDir, {recursive: true, force: true});

    // Prepare common data for beacon node processes
    const genesisStateFilepath = path.join(this.simDir, "genesis.ssz");
    const configFilepath = path.join(this.simDir, "config.yml");
    fs.mkdirSync(this.simDir, {recursive: true});
    fs.writeFileSync(genesisStateFilepath, this.genesisState.serialize());
    fs.writeFileSync(configFilepath, yaml.dump(chainConfigToJson(this.config)));

    // Start the beacon node processes
    for (const beaconNode of this.beaconNodes) {
      beaconNode.process = this.spawnForeverProcess({
        processId: beaconNode.processId,
        onError,
        stdoutFilepath: path.join(logDir, `${beaconNode.processId}_stdout.log`),
        spawnOpts: prepareBeaconNodeArgs({
          client: beaconNode.client,
          p2pPort: beaconNode.p2pPort,
          restPort: beaconNode.restPort,
          isSingleNode: this.params.beaconNodes.length === 1,
          genesisTime: this.genesisTime,
          dataDir: path.join(this.simDir, beaconNode.processId),
          genesisStateFilepath,
          configFilepath,
          preset: this.params.preset,
          logFilepath: path.join(logDir, `${beaconNode.processId}.log`),
          logToStd: this.pipeLogsToStd,
          processName: `${this.params.runId}_${beaconNode.processId}`,
        }),
      });
    }

    const apiClients = this.beaconNodes.map((beaconNode) =>
      // Using the default chainConfig doesn't matter, since this client is only used for the health check
      getClient({baseUrl: getLocalAddress(beaconNode.restPort)}, {config: createIChainForkConfig(chainConfig)})
    );

    // Wait for beacon nodes to come online
    await waitForHealthyBeaconNodes(apiClients);
    this.log(`${this.beaconNodes.length} nodes healthy`);

    // Connect beacon nodes between themselves
    await connectBeaconNodes(apiClients);
    this.log("All nodes connected");

    if (this.externalSigners.length) {
      // Start external signers
      for (const externalSigner of this.externalSigners) {
        // TODO: Use consensys/web3signer docker image here
        // Using an in-memory web3signer takes resources from the main thread
        externalSigner.process = prepareInMemoryWeb3signer(onError, {
          port: externalSigner.port,
          secretKeys: externalSigner.signer.secretKeys,
        });
      }

      // Wait for external signers to come online
      await waitForWeb3signerApiActive(this.externalSigners.map((extSig) => extSig.port));
      this.log(`${this.externalSigners.length} external signers healthy`);
    }

    // Start validator clients
    for (const validator of this.validators) {
      validator.process = this.spawnForeverProcess({
        processId: validator.processId,
        onError,
        stdoutFilepath: path.join(logDir, `${validator.processId}_stdout.log`),
        spawnOpts: prepareValidatorArgs({
          client: validator.client,
          beaconUrl: validator.beaconUrl,
          keymanagerPort: validator.keymanagerPort,
          genesisTime: this.genesisTime,
          dataDir: path.join(this.simDir, validator.processId),
          genesisStateFilepath,
          configFilepath,
          preset: this.params.preset,
          logFilepath: path.join(logDir, `${validator.processId}.log`),
          logToStd: this.pipeLogsToStd,
          processName: `${this.params.runId}_${validator.processId}`,
          signer: validator.signer,
        }),
      });
    }

    // Wait for validators to come online
    await waitForKeymanagerApiActive(this.validators.map((vc) => vc.keymanagerPort));
    this.log(`${this.validators.length} validators healthy`);

    // Print time to genesis to calibrate initialization times
    const secToGenesis = this.genesisTime - Date.now() / 1000;
    if (secToGenesis > 0) {
      this.log(`Everything ready, genesis in ${this.genesisTime - Date.now() / 1000} sec`);
    } else {
      throw Error(`Genesis already happened ${secToGenesis} sec ago, not enough lead time`);
    }
  }

  // this.tracker = new SimulationTracker(this.nodes, this.clock, this.params, this.controller.signal);

  async kill(): Promise<void> {
    // Kill by dependency order: first beacon, then external signer, then validator client
    for (const subproc of [...this.beaconNodes, ...this.externalSigners, ...this.validators]) {
      if (subproc.process) {
        await subproc.process.killGracefully().catch((e) => {
          console.error(`Error killing ${subproc.processId}`, e);
        });
        this.log(`Killed subproc ${subproc.processId} pid ${subproc.process.pid}`);
      } else {
        this.log(`Process ${subproc.processId} does not have a subprocess`);
      }
    }
  }

  async reconnectAllBeaconNodes(): Promise<void> {
    await connectBeaconNodes(
      this.beaconNodes.map((beaconNode) =>
        getClient({baseUrl: getLocalAddress(beaconNode.restPort)}, {config: createIChainForkConfig(chainConfig)})
      )
    );
  }

  waitForEpoch(epoch: Epoch): Promise<void> {
    const secAtEpoch = epoch * SLOTS_PER_EPOCH * this.config.SECONDS_PER_SLOT + this.genesisTime;
    return promisify(setTimeout)(secAtEpoch * 1000 - Date.now());
  }

  getNetworkData(): NetworkData {
    return {
      validatorCount: this.validatorCount,
      genesisTime: this.genesisTime,
      genesisState: this.genesisState,
      config: this.config,
      beaconNodes: this.beaconNodes,
    };
  }

  private spawnForeverProcess({
    processId,
    onError,
    stdoutFilepath,
    spawnOpts,
  }: {
    processId: string;
    onError: OnError;
    stdoutFilepath: string;
    spawnOpts: SpwanOpts;
  }): SubprocessForever {
    const proc = child_process.spawn(spawnOpts.command, spawnOpts.args, {
      env: {...process.env, ...spawnOpts.env},
    });

    fs.mkdirSync(path.dirname(stdoutFilepath), {recursive: true});
    const stdoutFile = fs.createWriteStream(stdoutFilepath);

    // Pipe all output to file
    proc.stdout.pipe(stdoutFile);
    proc.stderr.pipe(stdoutFile);

    let bufferedStd = "";

    const formatChunk = (chunk: Buffer): string => {
      const str = Buffer.from(chunk).toString("utf8");
      return (
        str
          .split("\n")
          // Do not prefix last line with only \n
          .map((s) => (s.length > 1 ? `${processId} ${s}` : s))
          .join("\n")
      );
    };

    if (this.pipeLogsToStd) {
      proc.stdout.on("data", (chunk) => process.stdout.write(formatChunk(chunk)));
      proc.stderr.on("data", (chunk) => process.stderr.write(formatChunk(chunk)));
    } else {
      const onDataChunk = (chunk: Buffer): void => {
        bufferedStd += formatChunk(chunk);

        // limit size of buffered STD
        if (bufferedStd.length > 1.5 * MAX_STD_BUFFERED) {
          bufferedStd = bufferedStd.slice(0, MAX_STD_BUFFERED);
        }
      };

      proc.stdout.on("data", onDataChunk);
      proc.stderr.on("data", onDataChunk);
    }

    proc.on("exit", (code) => {
      // Dump last `MAX_STD_BUFFERED` logs to console if not already piped for debuggability
      if (!this.pipeLogsToStd) {
        console.log(bufferedStd);
      }
      onError(Error(`Process ${processId} exited with code ${code}`));
    });

    return {
      get pid() {
        return proc.pid ?? 0;
      },
      killGracefully(): Promise<void> {
        proc.kill("SIGKILL");
        proc.removeAllListeners("exit");

        return new Promise((resolve, reject) => {
          proc.on("exit", (code) => {
            if (code === null || code === 0) {
              resolve();
            } else {
              reject(Error(`process ${processId} exit ${code}`));
            }
          });
        });
      },
    };
  }

  private log: typeof console.log = (...args) => {
    console.log(formatEpochSlotTime(this.genesisTime, this.config), ...args);
  };
}

type OnError = (error: Error) => void;

function getGenesisDelaySec(beaconNodes: BeaconNodeOpts[]): number {
  let genesisDelay = 0;

  for (const beaconNode of beaconNodes) {
    // Lodestar needs ~20s to start on mid-tier local computer. ~40s in Github runners
    if (beaconNode.client === "lodestar") {
      genesisDelay = Math.max(genesisDelay, LODESTAR_STARTUP_TIME);
    }
  }

  return genesisDelay;
}

function getTotalValidatorCount(beaconNodes: BeaconNodeOpts[]): number {
  let totalValidators = 0;

  for (const beaconNode of beaconNodes) {
    totalValidators += beaconNode.keysPerValidatorClient * beaconNode.validatorClients;
  }

  return totalValidators;
}

async function waitForHealthyBeaconNodes(apiClients: Api[]): Promise<void> {
  await Promise.all(
    apiClients.map(async (api) => {
      return retry(
        async () => {
          const health = await api.node.getHealth();
          // Both READY and SYNCING are good to go, since Lodestar returns SYNCING pre-genesis
          if (health === routes.node.NodeHealth.READY || health === routes.node.NodeHealth.SYNCING) {
            return; // OK
          } else {
            throw Error(`Not ready ${health}`);
          }
        },
        {retries: 120, retryDelay: 1000}
      );
    })
  );
}

async function waitForKeymanagerApiActive(ports: number[]): Promise<void> {
  const apiClients = ports.map((port) => getClientKeymanager({baseUrl: getLocalAddress(port)}));

  await Promise.all(
    apiClients.map(async (api) => {
      return retry(
        async () => {
          await api.listKeys();
        },
        {retries: 120, retryDelay: 1000}
      );
    })
  );
}

async function waitForWeb3signerApiActive(ports: number[]): Promise<void> {
  await Promise.all(
    ports.map(async (port) => {
      return retry(
        async () => {
          const res = await fetch(getLocalAddress(port) + "/upcheck");
          if (!res.ok) throw Error(`Not OK ${res.status}`);
        },
        {retries: 120, retryDelay: 1000}
      );
    })
  );
}

async function connectBeaconNodes(apiClients: Api[]): Promise<void> {
  const networkIdentity = await Promise.all(
    apiClients.map(async (api) => {
      return (await api.node.getNetworkIdentity()).data;
    })
  );

  for (let i = 0; i < apiClients.length; i++) {
    for (let j = 0; j < apiClients.length; j++) {
      // Don't connect node to itself
      if (i === j) continue;

      const {peerId, p2pAddresses} = networkIdentity[j];
      await apiClients[i].lodestar.connectPeer(peerId, p2pAddresses);
    }
  }
}

function deriveSecretKeys(startKeyIndex: number, keyCount: number): SecretKey[] {
  const secretKeys: SecretKey[] = [];
  for (let i = startKeyIndex; i < startKeyIndex + keyCount; i++) {
    secretKeys.push(interopSecretKey(i));
  }
  return secretKeys;
}

async function generateKeystores(secretKeys: SecretKey[]): Promise<LocalKeystores> {
  const password = "test_password";
  const keystores: string[] = [];
  const publicKeys: string[] = [];

  // TODO: Use insecure algorithm to speedup generation
  for (const secretKey of secretKeys) {
    const pubkey = secretKey.toPublicKey().toBytes();
    const keystore = await Keystore.create(password, secretKey.toBytes(), pubkey, "");
    keystores.push(keystore.stringify());
    publicKeys.push(toHex(pubkey));
  }

  return {useExternalSigner: false, keystores, password, secretKeys, publicKeys};
}
