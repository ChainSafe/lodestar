import {Mock, Mocked, vi} from "vitest";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {ChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {EpochDifference, ForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/utils";
import {BeaconProposerCache} from "../../src/chain/beaconProposerCache.js";
import {BeaconChain} from "../../src/chain/chain.js";
import {ChainEventEmitter} from "../../src/chain/emitter.js";
import {LightClientServer} from "../../src/chain/lightClient/index.js";
import {AggregatedAttestationPool, OpPool, SyncContributionAndProofPool} from "../../src/chain/opPools/index.js";
import {QueuedStateRegenerator} from "../../src/chain/regen/index.js";
import {SeenBlockInput} from "../../src/chain/seenCache/seenGossipBlockInput.js";
import {ShufflingCache} from "../../src/chain/shufflingCache.js";
import {ExecutionBuilderHttp} from "../../src/execution/builder/http.js";
import {ExecutionEngineHttp} from "../../src/execution/engine/index.js";
import {Clock} from "../../src/util/clock.js";
import {getMockedClock} from "./clock.js";
import {getMockedLogger} from "./loggerMock.js";

export type MockedBeaconChain = Mocked<BeaconChain> & {
  logger: Mocked<Logger>;
  forkChoice: MockedForkChoice;
  executionEngine: Mocked<ExecutionEngineHttp>;
  executionBuilder: Mocked<ExecutionBuilderHttp>;
  opPool: Mocked<OpPool>;
  aggregatedAttestationPool: Mocked<AggregatedAttestationPool>;
  syncContributionAndProofPool: Mocked<SyncContributionAndProofPool>;
  beaconProposerCache: Mocked<BeaconProposerCache>;
  seenBlockInputCache: Mocked<SeenBlockInput>;
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

  const ForkChoice = vi.fn().mockImplementation(function MockedForkChoice() {
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
      getAllAncestorAndNonAncestorBlocks: vi.fn(),
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
vi.mock("../../src/chain/beaconProposerCache.js");
vi.mock("../../src/chain/seenCache/seenGossipBlockInput.js");
vi.mock("../../src/chain/shufflingCache.js");
vi.mock("../../src/chain/lightClient/index.js");

vi.mock("../../src/chain/opPools/index.js", async (importActual) => {
  const mod = await importActual<typeof import("../../src/chain/opPools/index.js")>();

  const OpPool = vi.fn().mockImplementation(function MockedOpPool() {
    return {
      hasSeenBlsToExecutionChange: vi.fn(),
      hasSeenVoluntaryExit: vi.fn(),
      hasSeenProposerSlashing: vi.fn(),
      hasSeenAttesterSlashing: vi.fn(),
      getSlashingsAndExits: vi.fn(),
    };
  });

  const AggregatedAttestationPool = vi.fn().mockImplementation(function MockedAggregatedAttestationPool() {
    return {
      getAttestationsForBlock: vi.fn(),
    };
  });

  const SyncContributionAndProofPool = vi.fn().mockImplementation(function MockedSyncContributionAndProofPool() {
    return {
      getAggregate: vi.fn(),
    };
  });

  return {
    ...mod,
    OpPool,
    AggregatedAttestationPool,
    SyncContributionAndProofPool,
  };
});

vi.mock("../../src/chain/chain.js", async (importActual) => {
  const mod = await importActual<typeof import("../../src/chain/chain.js")>();

  const BeaconChain = vi.fn().mockImplementation(function MockedBeaconChain({
    clock: clockParam,
    genesisTime,
    config,
  }: MockedBeaconChainOptions) {
    const logger = getMockedLogger();
    const clock =
      clockParam === "real" ? new Clock({config, genesisTime, signal: new AbortController().signal}) : getMockedClock();

    return {
      config,
      opts: {},
      genesisTime,
      clock,
      forkChoice: getMockedForkChoice(),
      executionEngine: {
        notifyForkchoiceUpdate: vi.fn(),
        getPayload: vi.fn(),
        getClientVersion: vi.fn(),
      },
      executionBuilder: {},
      opPool: new OpPool(),
      aggregatedAttestationPool: new AggregatedAttestationPool(config),
      syncContributionAndProofPool: new SyncContributionAndProofPool(config, clock),
      // @ts-expect-error
      beaconProposerCache: new BeaconProposerCache(),
      // @ts-expect-error
      seenBlockInputCache: new SeenBlockInput(),
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
  return vi.mocked(new ForkChoice({} as any, {} as any, {} as any, {} as any, {} as any));
}

// To avoid loading the package in test while mocked, exporting frequently used types and constants
export type {ProtoBlock};
export {EpochDifference};
