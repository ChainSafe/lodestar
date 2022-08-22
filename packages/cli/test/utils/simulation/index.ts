import {EventEmitter} from "events";
import {mkdir, rm, writeFile} from "node:fs/promises";
import tmp from "tmp";
import {TimeoutError} from "@lodestar/utils";
// import {SecretKey} from "@chainsafe/bls/types";
// import {Validator} from "@lodestar/validator";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
// import {TimestampFormatCode, toHexString} from "@lodestar/utils";
import {ChainEvent} from "@lodestar/beacon-node/chain";
import {nodeUtils} from "@lodestar/beacon-node/node";
// import {testLogger, TestLoggerOpts, LogLevel} from "../logger.js";
// import {getDevBeaconNode} from "../node/beacon.js";
// import {BeaconRestApiServerOpts} from "../../../src/api/rest/index.js";
// import {INTEROP_BLOCK_HASH} from "../../../src/node/utils/interop/state.js";
// import {simTestInfoTracker} from "../node/simTest.js";
// import {getAndInitDevValidators} from "../node/validator.js";
// import {createExternalSignerServer} from "../../../../validator/test/utils/createExternalSignerServer.js";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {toHexString} from "@lodestar/utils";
import {beaconHandler} from "../../../src/cmds/beacon/handler.js";
import {IBeaconArgs} from "../../../src/cmds/beacon/options.js";
import {getBeaconConfigFromArgs} from "../../../src/config/beaconParams.js";
import {IGlobalArgs} from "../../../src/options/globalOptions.js";
import {BeaconNodeInstrument} from "./instruments/BeaconNodeInstrument.js";

type SimulationRequiredParams = {
  validatorClientCount: number;
  altairEpoch: number;
  bellatrixEpoch: number;
  chainEvent: ChainEvent.justified | ChainEvent.finalized;
};

type SimulationOptionalParams = {
  validatorsPerClient: number;
  withExternalSigner: boolean;
  slotsPerEpoch: number;
  secondsPerSlot: number;
  epochsOfMargin: number;
  timeoutSetupMargin: number;
  genesisSlotsDelay: number;
  anchorState?: BeaconStateAllForks;
};

export type RunTimeSimulationParams = {
  genesisTime: number;
  expectedTimeout: number;
};

export type SimulationParams = SimulationRequiredParams & Required<SimulationOptionalParams> & RunTimeSimulationParams;

export type SimulationEnvironment = {
  simulationParams: SimulationParams;
  beaconNodeEventInstrument: BeaconNodeInstrument;
  // beaconNode: BeaconNode;
  // validators: Validator[];
  // secretKeys: SecretKey[];
  // secretKeysMap: Map<SecretKey, Validator>;
  simulationId: string;
  stop: () => Promise<void[]>;
  start: () => Promise<void[]>;
};

export const defaultSimulationParams: SimulationOptionalParams = {
  validatorsPerClient: 32 * 4,
  withExternalSigner: false,
  slotsPerEpoch: SLOTS_PER_EPOCH,
  secondsPerSlot: 2,
  // 1 epoch of margin of error
  epochsOfMargin: 1,
  // Give extra 5 seconds of margin
  timeoutSetupMargin: 5 * 1000,

  // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
  // allow time for bls worker threads to warm up
  genesisSlotsDelay: 20,
};

export const logFilesDir = "simulation-logs";
export const INTEROP_BLOCK_HASH = Buffer.alloc(32, "B");

export const getSimulationId = ({
  validatorClientCount,
  validatorsPerClient,
  withExternalSigner,
  altairEpoch,
  bellatrixEpoch,
}: SimulationParams): string =>
  `vc-${validatorClientCount}_vpc-${validatorsPerClient}_${
    withExternalSigner ? "external_signer" : "local_signer"
  }_altair-${altairEpoch}_bellatrix-${bellatrixEpoch}`;

export const createSimulationEnvironment = async (
  params: SimulationRequiredParams & Partial<SimulationOptionalParams>
): Promise<SimulationEnvironment> => {
  const paramsWithDefaults = {...defaultSimulationParams, ...params} as SimulationRequiredParams &
    SimulationOptionalParams;

  // Should reach justification in 3 epochs max, and finalization in 4 epochs max
  const expectedEpochsToFinish = params.chainEvent === ChainEvent.justified ? 3 : 4;
  const genesisTime =
    Math.floor(Date.now() / 1000) + paramsWithDefaults.genesisSlotsDelay * paramsWithDefaults.secondsPerSlot;

  const expectedTimeout =
    ((paramsWithDefaults.epochsOfMargin + expectedEpochsToFinish) * paramsWithDefaults.slotsPerEpoch +
      paramsWithDefaults.genesisSlotsDelay) *
    paramsWithDefaults.secondsPerSlot *
    1000;

  const simulationParams = {
    ...paramsWithDefaults,
    genesisTime,
    expectedTimeout,
  } as SimulationParams;

  // const {altairEpoch, bellatrixEpoch, validatorClientCount, validatorsPerClient, withExternalSigner} = simulationParams;

  const stopCallbacks: Array<() => Promise<void>> = [];
  const startCallbacks: Array<() => Promise<void>> = [];

  const rootDir = `${tmp.dirSync({unsafeCleanup: true}).name}/${getSimulationId(simulationParams)}`;
  await mkdir(rootDir);
  stopCallbacks.push(() => rm(rootDir, {recursive: true}));

  const args = {
    network: "dev",
    preset: "minimal",
    rootDir: rootDir,
    "api.rest.enabled": true,
    "api.rest.address": "127.0.0.1",
    "api.rest.port": 9596,
    "sync.isSingleNode": true,
    "network.allowPublishToZeroPeers": true,
    "eth1.enabled": false,
    "network.discv5.enabled": false,
    "metrics.enabled": false,
  } as IBeaconArgs & IGlobalArgs;

  // Register instruments
  const beaconEventInstrument = new BeaconNodeInstrument({
    opts: {
      executionEngine: {mode: "mock", genesisBlockHash: toHexString(INTEROP_BLOCK_HASH)},
    },
  });

  beaconEventInstrument.register();

  const paramsFile = `${rootDir}/params.json`;
  const paramsAsStringValues: Record<string, unknown> = {};
  for (const key of (Object.keys(simulationParams) as unknown) as keyof typeof simulationParams) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    paramsAsStringValues[key] = String(simulationParams[key]);
  }
  await writeFile(paramsFile, JSON.stringify(paramsAsStringValues, null, 2));

  const config = getBeaconConfigFromArgs(args);
  const {state} = nodeUtils.initDevState(config, paramsWithDefaults.validatorClientCount, {genesisTime});

  const genesisStateFile = `${rootDir}/genesis.ssz`;
  await writeFile(genesisStateFile, state.serialize());

  startCallbacks.push(async () => {
    await beaconHandler({
      ...args,
      paramsFile,
      genesisStateFile,
    });
  });

  // const simulationLoggerOptions = getSimulationLoggerOptions(simulationParams);
  // const logger = testLogger("Node-A", simulationLoggerOptions);
  // const beaconNode = await getDevBeaconNode({
  //   params: {
  //     ...simulationParams,
  //     // eslint-disable-next-line @typescript-eslint/naming-convention
  //     ALTAIR_FORK_EPOCH: altairEpoch,
  //     // eslint-disable-next-line @typescript-eslint/naming-convention
  //     BELLATRIX_FORK_EPOCH: bellatrixEpoch,
  //   },
  //   options: {
  //     api: {rest: {enabled: true} as BeaconRestApiServerOpts},
  //     sync: {isSingleNode: true},
  //     network: {allowPublishToZeroPeers: true},
  //     executionEngine: {mode: "mock", genesisBlockHash: toHexString(INTEROP_BLOCK_HASH)},
  //   },
  //   validatorCount: validatorClientCount * validatorsPerClient,
  //   logger,
  //   genesisTime,
  // });
  // stopCallbacks.push(() => beaconNode.close());

  // const stopInfoTracker = simTestInfoTracker(beaconNode, logger);
  // stopCallbacks.push(async () => stopInfoTracker());

  // const externalSignerPort = 38000;
  // const externalSignerUrl = `http://localhost:${externalSignerPort}`;

  // const {validators, secretKeys} = await getAndInitDevValidators({
  //   node: beaconNode,
  //   validatorsPerClient,
  //   validatorClientCount,
  //   startIndex: 0,
  //   // At least one sim test must use the REST API for beacon <-> validator comms
  //   useRestApi: true,
  //   testLoggerOpts: simulationLoggerOptions,
  //   externalSignerUrl: withExternalSigner ? externalSignerUrl : undefined,
  // });

  // stopCallbacks.push(async () => {
  //   await Promise.all(validators.map((v) => v.close()));
  //   return;
  // });

  // if (withExternalSigner) {
  //   const server = createExternalSignerServer(secretKeys);
  //   stopCallbacks.push(async () => server.close());
  //   startCallbacks.push(async () => {
  //     await server.listen(externalSignerPort);
  //     return;
  //   });
  // }

  // const map = new Map<SecretKey, Validator>();
  // for (const [index, secretKey] of secretKeys.entries()) {
  //   map.set(secretKey, validators[index]);
  // }

  return {
    simulationParams,
    // beaconNode,
    // validators,
    // secretKeys,
    // secretKeysMap: map,
    // simulationId: getSimulationId(simulationParams),
    beaconNodeEventInstrument: beaconEventInstrument,
    simulationId: getSimulationId(simulationParams),
    stop: async () => Promise.all(stopCallbacks.map((cb) => cb())),
    start: async () => Promise.all(startCallbacks.map((cb) => cb())),
  };
};

export function waitForEvent<T>(
  emitter: EventEmitter,
  event: string,
  timeout = 3000,
  condition: (e: T) => boolean = () => true
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`event ${event} not received`)), timeout);
    emitter.on(event, (e) => {
      if (condition(e)) {
        clearTimeout(timer);
        resolve(e);
      }
    });
  });
}
