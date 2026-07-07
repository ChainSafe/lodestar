import {Mock, Mocked, vi} from "vitest";
import {BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {EpochDifference, ForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {createPubkeyCache} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";
import {BeaconEngine} from "../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconProposerCache} from "../../src/chain/beaconProposerCache.js";
import {BeaconChain} from "../../src/chain/chain.js";
import {ChainEventEmitter} from "../../src/chain/emitter.js";
import {LightClientServer} from "../../src/chain/lightClient/index.js";
import {AggregatedAttestationPool, OpPool, SyncContributionAndProofPool} from "../../src/chain/opPools/index.js";
import {QueuedStateRegenerator} from "../../src/chain/regen/index.js";
import {
  SeenAggregators,
  SeenAttesters,
  SeenBlockProposers,
  SeenContributionAndProof,
  SeenExecutionPayloadBids,
  SeenPayloadAttesters,
  SeenSyncCommitteeMessages,
} from "../../src/chain/seenCache/index.js";
import {SeenAggregatedAttestations} from "../../src/chain/seenCache/seenAggregateAndProof.js";
import {SeenAttestationDatas} from "../../src/chain/seenCache/seenAttestationData.js";
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
  // Engine head-selection methods surfaced on the flat mock (the mock doubles as the engine, so the
  // real `prepareForNextSlot` / `produceBlockBase` bound onto it call `this.recomputeForkChoiceHead`
  // etc.). No longer on the facade — stubbed here so tests can control head selection.
  recomputeForkChoiceHead: Mock<() => ProtoBlock>;
  predictProposerHead: Mock<() => ProtoBlock>;
  getProposerHead: Mock<() => ProtoBlock>;
  executionEngine: Mocked<ExecutionEngineHttp>;
  executionBuilder: Mocked<ExecutionBuilderHttp>;
  opPool: Mocked<OpPool>;
  aggregatedAttestationPool: Mocked<AggregatedAttestationPool>;
  syncContributionAndProofPool: Mocked<SyncContributionAndProofPool>;
  beaconProposerCache: Mocked<BeaconProposerCache>;
  // Engine-internal seen-caches surfaced on the flat mock (the mock doubles as the engine).
  seenAttesters: SeenAttesters;
  seenAggregators: SeenAggregators;
  seenPayloadAttesters: SeenPayloadAttesters;
  seenAggregatedAttestations: SeenAggregatedAttestations;
  seenExecutionPayloadBids: SeenExecutionPayloadBids;
  seenBlockProposers: SeenBlockProposers;
  seenSyncCommitteeMessages: SeenSyncCommitteeMessages;
  seenContributionAndProof: SeenContributionAndProof;
  seenAttestationDatas: SeenAttestationDatas;
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
      getBlockDefaultStatus: vi.fn(),
      getBlockHexDefaultStatus: vi.fn(),
      getBlockHexAndBlockHash: vi.fn(),
      getAllAncestorBlocks: vi.fn(),
      getAllNonAncestorBlocks: vi.fn(),
      getAllAncestorAndNonAncestorBlocks: vi.fn(),
      getAllAncestorAndNonAncestorBlocksDefaultStatus: vi.fn(),
      iterateAncestorBlocks: vi.fn(),
      getBlockSummariesByParentRoot: vi.fn(),
      getCanonicalBlockAtSlot: vi.fn(),
      getCanonicalBlockClosestLteSlot: vi.fn(),
      getCanonicalBlockByRoot: vi.fn(),
      getFinalizedCheckpoint: vi.fn(),
      getConfirmedRoot: vi.fn(),
      getConfirmedBlock: vi.fn(),
      hasBlock: vi.fn(),
      hasBlockHex: vi.fn(),
      getBlockSummariesAtSlot: vi.fn(),
      notifyPtcMessages: vi.fn(),
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
      opPool: new OpPool(config as BeaconConfig),
      aggregatedAttestationPool: new AggregatedAttestationPool(config as BeaconConfig),
      syncContributionAndProofPool: new SyncContributionAndProofPool(config, clock),
      // Engine-internal gossip seen-caches; the flat mock doubles as the engine, so validators read
      // these via `engine.seenX` and tests reach them via `chain.beaconEngine.seenX`.
      seenAttesters: new SeenAttesters(),
      seenAggregators: new SeenAggregators(),
      seenPayloadAttesters: new SeenPayloadAttesters(),
      seenAggregatedAttestations: new SeenAggregatedAttestations(null),
      seenExecutionPayloadBids: new SeenExecutionPayloadBids(),
      seenBlockProposers: new SeenBlockProposers(),
      seenSyncCommitteeMessages: new SeenSyncCommitteeMessages(),
      seenContributionAndProof: new SeenContributionAndProof(null),
      seenAttestationDatas: new SeenAttestationDatas(null),
      payloadAttestationPool: {
        add: vi.fn(),
        getAll: vi.fn(),
      },
      // @ts-expect-error
      beaconProposerCache: new BeaconProposerCache(),
      // @ts-expect-error
      seenBlockInputCache: new SeenBlockInput(),
      seenPayloadEnvelopeInputCache: {
        get: vi.fn(),
      },
      seenPayloadEnvelope: vi.fn(),
      shufflingCache: new ShufflingCache(),
      pubkeyCache: createPubkeyCache(),
      produceCommonBlockBody: vi.fn(),
      produceBlockBase: vi.fn(),
      getProposerHead: vi.fn(),
      produceBlock: vi.fn(),
      produceBlindedBlock: vi.fn(),
      getCanonicalBlockAtSlot: vi.fn(),
      getBlockByRoot: vi.fn(),
      getSerializedBlockByRoot: vi.fn(),
      getSerializedFinalizedBlockBySlot: vi.fn(),
      getCanonicalBlockRootSlotsByRange: vi.fn(),
      getFinalizedBlockSlotByRoot: vi.fn(),
      getSerializedFinalizedBlockByParentRoot: vi.fn(),
      recomputeForkChoiceHead: vi.fn(),
      predictProposerHead: vi.fn(),
      getHeadStateAtCurrentEpoch: vi.fn(),
      getHeadState: vi.fn(),
      getStateBySlot: vi.fn(),
      updateBuilderStatus: vi.fn(),
      processBlock: vi.fn(),
      persistInvalidSszValue: vi.fn(),
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
  const chain = new BeaconChain({
    clock: clock ?? "fake",
    genesisTime: genesisTime ?? 0,
    config: config ?? defaultConfig,
  }) as MockedBeaconChain;
  // The gossip validators are now BeaconEngine methods that read engine collaborators. In this flat
  // mock the facade doubles as the engine, so `chain.beaconEngine.forkChoice === chain.forkChoice` etc.
  (chain as {beaconEngine: unknown}).beaconEngine = chain;
  // Duty flows are real BeaconEngine methods; bind the real implementations (and the private helpers
  // they call) so duty tests exercise real logic against the mock's collaborators.
  // `prepareForNextSlot` is a real BeaconEngine method too; `recomputeForkChoiceHead` / `predictProposerHead`
  // stay as mock fns above so tests can control head selection.
  for (const name of [
    "getProposerDuties",
    "getAttesterDuties",
    "getSyncCommitteeDuties",
    "getPtcDuties",
    "getHeadStateAtEpoch",
    "waitForCheckpointState",
    "genesisBlockRoot",
    "prepareForNextSlot",
    "computeStateHashTreeRoot",
    "resolvePayloadAttributesInput",
    "getPayloadAttributesForSSE",
    "getProposerTargetGasLimit",
    // Proposer cache + finalized balances bridges (forward to the mock's collaborators).
    "getProposerFeeRecipient",
    "updateProposerPreparation",
    "getProposerCacheValidatorIndices",
    "getCheckpointEffectiveBalances",
    // Op-pool add/read bridges (forward to the mock's pools).
    "addAttestationToPool",
    "getAttestationAggregate",
    "addAggregatedAttestation",
    "getPoolAggregatedAttestations",
    "addSyncCommitteeMessage",
    "getSyncCommitteeContribution",
    "addSyncContributionAndProof",
    "addPayloadAttestation",
    "getPoolPayloadAttestations",
    "addExecutionPayloadBid",
  ] as const) {
    (chain as unknown as Record<string, unknown>)[name] = (
      BeaconEngine.prototype as unknown as Record<string, unknown>
    )[name];
  }
  return chain;
}

export type MockedForkChoice = Mocked<ForkChoice>;

export function getMockedForkChoice(): MockedForkChoice {
  // ForkChoice package is mocked globally
  return vi.mocked(new ForkChoice({} as any, {} as any, {} as any, {} as any, {} as any));
}

// To avoid loading the package in test while mocked, exporting frequently used types and constants
export type {ProtoBlock};
export {EpochDifference};
