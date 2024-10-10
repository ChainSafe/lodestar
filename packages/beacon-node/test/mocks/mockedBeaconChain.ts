import {vi, Mocked, Mock} from "vitest";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {config as defaultConfig} from "@lodestar/config/default";
import {ChainForkConfig} from "@lodestar/config";
import {ForkChoice, ProtoBlock, EpochDifference} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/utils";
import {BeaconChain} from "../../src/chain/chain.js";
import {ChainEventEmitter} from "../../src/chain/emitter.js";
import {ExecutionEngineHttp} from "../../src/execution/engine/index.js";
import {ExecutionBuilderHttp} from "../../src/execution/builder/http.js";
import {Eth1ForBlockProduction} from "../../src/eth1/index.js";
import {OpPool, AggregatedAttestationPool} from "../../src/chain/opPools/index.js";
import {BeaconProposerCache} from "../../src/chain/beaconProposerCache.js";
import {LightClientServer} from "../../src/chain/lightClient/index.js";
import {Clock} from "../../src/util/clock.js";
import {QueuedStateRegenerator} from "../../src/chain/regen/index.js";
import {ShufflingCache} from "../../src/chain/shufflingCache.js";
import {getMockedLogger} from "./loggerMock.js";
import {getMockedClock} from "./clock.js";

export type MockedBeaconChain = Mocked<BeaconChain> & {
  logger: Mocked<Logger>;
  getHeadState: Mock;
  forkChoice: MockedForkChoice;
  executionEngine: Mocked<ExecutionEngineHttp>;
  executionBuilder: Mocked<ExecutionBuilderHttp>;
  eth1: Mocked<Eth1ForBlockProduction>;
  opPool: Mocked<OpPool>;
  aggregatedAttestationPool: Mocked<AggregatedAttestationPool>;
  beaconProposerCache: Mocked<BeaconProposerCache>;
  shufflingCache: Mocked<ShufflingCache>;
  regen: Mocked<QueuedStateRegenerator>;
  bls: {
    verifySignatureSets: Mock<() => boolean>;
    verifySignatureSetsSameMessage: Mock<() => boolean>;
    close: Mock;
    canAcceptWork: Mock<() => boolean>;
  };
  lightClientServer: Mocked<LightClientServer>;
};

vi.mock("@lodestar/fork-choice", async (importActual) => {
  const mod = await importActual<typeof import("@lodestar/fork-choice")>();

  const ForkChoice = vi.fn().mockImplementation(() => {
    return {
      updateTime: vi.fn(),
      getJustifiedBlock: vi.fn(),
      getFinalizedBlock: vi.fn(),
      getHead: vi.fn(),
      getHeadRoot: vi.fn(),
      getDependentRoot: vi.fn(),
      getBlockHex: vi.fn(),
      getBlock: vi.fn(),
      getAllAncestorBlocks: vi.fn(),
      getAllNonAncestorBlocks: vi.fn(),
      iterateAncestorBlocks: vi.fn(),
      getBlockSummariesByParentRoot: vi.fn(),
      getCanonicalBlockAtSlot: vi.fn(),
      getFinalizedCheckpoint: vi.fn(),
      hasBlockHex: vi.fn(),
      getBlockSummariesAtSlot: vi.fn(),
    };
  });

  return {
    ...mod,
    ForkChoice,
  };
});

vi.mock("../../src/chain/regen/index.js");
vi.mock("../../src/eth1/index.js");
vi.mock("../../src/chain/beaconProposerCache.js");
vi.mock("../../src/chain/shufflingCache.js");
vi.mock("../../src/chain/lightClient/index.js");

vi.mock("../../src/chain/opPools/index.js", async (importActual) => {
  const mod = await importActual<typeof import("../../src/chain/opPools/index.js")>();

  const OpPool = vi.fn().mockImplementation(() => {
    return {
      hasSeenBlsToExecutionChange: vi.fn(),
      hasSeenVoluntaryExit: vi.fn(),
      hasSeenProposerSlashing: vi.fn(),
      hasSeenAttesterSlashing: vi.fn(),
      getSlashingsAndExits: vi.fn(),
    };
  });

  const AggregatedAttestationPool = vi.fn().mockImplementation(() => {
    return {
      getAttestationsForBlock: vi.fn(),
    };
  });

  return {
    ...mod,
    OpPool,
    AggregatedAttestationPool,
  };
});

vi.mock("../../src/chain/chain.js", async (importActual) => {
  const mod = await importActual<typeof import("../../src/chain/chain.js")>();

  const BeaconChain = vi.fn().mockImplementation(({clock, genesisTime, config}: MockedBeaconChainOptions) => {
    const logger = getMockedLogger();

    return {
      config,
      opts: {},
      genesisTime,
      clock:
        clock === "real" ? new Clock({config, genesisTime, signal: new AbortController().signal}) : getMockedClock(),
      forkChoice: getMockedForkChoice(),
      executionEngine: {
        notifyForkchoiceUpdate: vi.fn(),
        getPayload: vi.fn(),
        getClientVersion: vi.fn(),
      },
      executionBuilder: {},
      // @ts-expect-error
      eth1: new Eth1ForBlockProduction(),
      opPool: new OpPool(),
      aggregatedAttestationPool: new AggregatedAttestationPool(config),
      // @ts-expect-error
      beaconProposerCache: new BeaconProposerCache(),
      shufflingCache: new ShufflingCache(),
      pubkey2index: new PubkeyIndexMap(),
      index2pubkey: [],
      produceCommonBlockBody: vi.fn(),
      getProposerHead: vi.fn(),
      produceBlock: vi.fn(),
      produceBlindedBlock: vi.fn(),
      getCanonicalBlockAtSlot: vi.fn(),
      recomputeForkChoiceHead: vi.fn(),
      predictProposerHead: vi.fn(),
      getHeadStateAtCurrentEpoch: vi.fn(),
      getHeadState: vi.fn(),
      getStateBySlot: vi.fn(),
      updateBuilderStatus: vi.fn(),
      processBlock: vi.fn(),
      regenStateForAttestationVerification: vi.fn(),
      close: vi.fn(),
      logger,
      regen: new QueuedStateRegenerator({} as any),
      lightClientServer: new LightClientServer({} as any, {} as any),
      bls: {
        verifySignatureSets: vi.fn().mockResolvedValue(true),
        verifySignatureSetsSameMessage: vi.fn().mockResolvedValue([true]),
        close: vi.fn().mockResolvedValue(true),
        canAcceptWork: vi.fn().mockReturnValue(true),
      },
      emitter: new ChainEventEmitter(),
    };
  });

  return {
    ...mod,
    BeaconChain,
  };
});

export type MockedBeaconChainOptions = {
  clock: "real" | "fake";
  genesisTime: number;
  config: ChainForkConfig;
};

export function getMockedBeaconChain(opts?: Partial<MockedBeaconChainOptions>): MockedBeaconChain {
  const {clock, genesisTime, config} = opts ?? {};
  // @ts-expect-error
  return new BeaconChain({
    clock: clock ?? "fake",
    genesisTime: genesisTime ?? 0,
    config: config ?? defaultConfig,
  }) as MockedBeaconChain;
}

export type MockedForkChoice = Mocked<ForkChoice>;

export function getMockedForkChoice(): MockedForkChoice {
  // ForkChoice package is mocked globally
  return vi.mocked(new ForkChoice({} as any, {} as any, {} as any, {} as any));
}

// To avoid loading the package in test while mocked, exporting frequently used types and constants
export type {ProtoBlock};
export {EpochDifference};
