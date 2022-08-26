import {EventEmitter} from "events";
import {TimeoutError} from "@lodestar/utils";

export * from "./LodestarBeaconNodeProcess.js";
export * from "./SimulationEnvironment.js";
export * from "./utils.js";

// export const createSimulationEnvironment = async (
//   params: SimulationRequiredParams & Partial<SimulationOptionalParams>
// ): Promise<SimulationEnvironment> => {
//   const rootDir = `${tmp.dirSync({unsafeCleanup: true}).name}/${getSimulationId(simulationParams)}`;
//   await mkdir(rootDir);
//   stopCallbacks.push(() => rm(rootDir, {recursive: true}));

//   const args = {
//     network: "dev",
//     preset: "minimal",
//     rootDir: rootDir,
//     "api.rest.enabled": true,
//     "api.rest.address": "127.0.0.1",
//     "api.rest.port": 9596,
//     "sync.isSingleNode": true,
//     "network.allowPublishToZeroPeers": true,
//     "eth1.enabled": false,
//     "network.discv5.enabled": false,
//     "metrics.enabled": false,
//   } as IBeaconArgs & IGlobalArgs;

//   // Register instruments
//   const beaconEventInstrument = new BeaconNodeInstrument({
//     opts: {
//       executionEngine: {mode: "mock", genesisBlockHash: toHexString(INTEROP_BLOCK_HASH)},
//     },
//   });

//   beaconEventInstrument.register();

//   const paramsFile = `${rootDir}/params.json`;
//   const paramsAsStringValues: Record<string, unknown> = {};
//   for (const key of (Object.keys(simulationParams) as unknown) as keyof typeof simulationParams) {
//     // eslint-disable-next-line @typescript-eslint/ban-ts-comment
//     // @ts-expect-error
//     paramsAsStringValues[key] = String(simulationParams[key]);
//   }
//   await writeFile(paramsFile, JSON.stringify(paramsAsStringValues, null, 2));

//   const config = getBeaconConfigFromArgs(args);
//   const {state} = nodeUtils.initDevState(config, paramsWithDefaults.validatorClientCount, {genesisTime});

//   const genesisStateFile = `${rootDir}/genesis.ssz`;
//   await writeFile(genesisStateFile, state.serialize());

//   startCallbacks.push(async () => {
//     await beaconHandler({
//       ...args,
//       paramsFile,
//       genesisStateFile,
//     });
//   });

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

// return {
//   simulationParams,
//   // beaconNode,
//   // validators,
//   // secretKeys,
//   // secretKeysMap: map,
//   // simulationId: getSimulationId(simulationParams),
//   beaconNodeEventInstrument: beaconEventInstrument,
//   simulationId: getSimulationId(simulationParams),
//   stop: async () => Promise.all(stopCallbacks.map((cb) => cb())),
//   start: async () => Promise.all(startCallbacks.map((cb) => cb())),
// };
// };

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
