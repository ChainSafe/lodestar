import {SecretKey} from "@chainsafe/bls/types";
import {Validator} from "@lodestar/validator";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {TimestampFormatCode, toHexString} from "@lodestar/utils";
import {ChainEvent} from "../../../src/chain/index.js";
import {testLogger, TestLoggerOpts, LogLevel} from "../logger.js";
import {getDevBeaconNode} from "../node/beacon.js";
import {BeaconRestApiServerOpts} from "../../../src/api/rest/index.js";
import {INTEROP_BLOCK_HASH} from "../../../src/node/utils/interop/state.js";
import {simTestInfoTracker} from "../node/simTest.js";
import {BeaconNode} from "../../../src/index.js";
import {getAndInitDevValidators} from "../node/validator.js";
import {createExternalSignerServer} from "../../../../validator/test/utils/createExternalSignerServer.js";

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
};

export type RunTimeSimulationParams = {
  genesisTime: number;
  expectedTimeout: number;
};

export type SimulationParams = SimulationRequiredParams & Required<SimulationOptionalParams> & RunTimeSimulationParams;

export type SimulationEnvironment = {
  simulationParams: SimulationParams;
  beaconNode: BeaconNode;
  validators: Validator[];
  secretKeys: SecretKey[];
  secretKeysMap: Map<SecretKey, Validator>;
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

export const getSimulationLoggerOptions = (params: SimulationParams): TestLoggerOpts => {
  const simulationId = getSimulationId(params);

  const testLoggerOpts: TestLoggerOpts = {
    logLevel: LogLevel.info,
    logFile: `${logFilesDir}/${simulationId}.log`,
    timestampFormat: {
      format: TimestampFormatCode.EpochSlot,
      genesisTime: params.genesisTime,
      slotsPerEpoch: params.slotsPerEpoch,
      secondsPerSlot: params.secondsPerSlot,
    },
  };

  return testLoggerOpts;
};

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

  const {altairEpoch, bellatrixEpoch, validatorClientCount, validatorsPerClient, withExternalSigner} = simulationParams;

  const stopCallbacks: Array<() => Promise<void>> = [];
  const startCallbacks: Array<() => Promise<void>> = [];

  const simulationLoggerOptions = getSimulationLoggerOptions(simulationParams);
  const logger = testLogger("Node-A", simulationLoggerOptions);
  const beaconNode = await getDevBeaconNode({
    params: {
      ...simulationParams,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      ALTAIR_FORK_EPOCH: altairEpoch,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      BELLATRIX_FORK_EPOCH: bellatrixEpoch,
    },
    options: {
      api: {rest: {enabled: true} as BeaconRestApiServerOpts},
      sync: {isSingleNode: true},
      network: {allowPublishToZeroPeers: true},
      executionEngine: {mode: "mock", genesisBlockHash: toHexString(INTEROP_BLOCK_HASH)},
    },
    validatorCount: validatorClientCount * validatorsPerClient,
    logger,
    genesisTime,
  });
  stopCallbacks.push(() => beaconNode.close());

  const stopInfoTracker = simTestInfoTracker(beaconNode, logger);
  stopCallbacks.push(async () => stopInfoTracker());

  const externalSignerPort = 38000;
  const externalSignerUrl = `http://localhost:${externalSignerPort}`;

  const {validators, secretKeys} = await getAndInitDevValidators({
    node: beaconNode,
    validatorsPerClient,
    validatorClientCount,
    startIndex: 0,
    // At least one sim test must use the REST API for beacon <-> validator comms
    useRestApi: true,
    testLoggerOpts: simulationLoggerOptions,
    externalSignerUrl: withExternalSigner ? externalSignerUrl : undefined,
  });

  stopCallbacks.push(async () => {
    await Promise.all(validators.map((v) => v.close()));
    return;
  });

  if (withExternalSigner) {
    const server = createExternalSignerServer(secretKeys);
    stopCallbacks.push(async () => server.close());
    startCallbacks.push(async () => {
      await server.listen(externalSignerPort);
      return;
    });
  }

  const map = new Map<SecretKey, Validator>();
  for (const [index, secretKey] of secretKeys.entries()) {
    map.set(secretKey, validators[index]);
  }

  return {
    simulationParams,
    beaconNode,
    validators,
    secretKeys,
    secretKeysMap: map,
    simulationId: getSimulationId(simulationParams),
    stop: async () => Promise.all(stopCallbacks.map((cb) => cb())),
    start: async () => Promise.all(startCallbacks.map((cb) => cb())),
  };
};
