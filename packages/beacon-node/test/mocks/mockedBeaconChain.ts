import {Mock, Mocked, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {EpochDifference, ForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {IBeaconStateView} from "@lodestar/state-transition";
import {Slot, ssz} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {BeaconEngineCore} from "../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEventBus} from "../../src/chain/beaconEngine/events.js";
import {BeaconProposerCache} from "../../src/chain/beaconProposerCache.js";
import {BlockSerializedCache} from "../../src/chain/blocks/blockSerializedCache.js";
import {BuilderCircuitBreaker} from "../../src/chain/builderCircuitBreaker.js";
import {BeaconChain} from "../../src/chain/chain.js";
import {ChainEventEmitter} from "../../src/chain/emitter.js";
import {ForkchoiceCaller} from "../../src/chain/forkChoice/index.js";
import {LightClientServer} from "../../src/chain/lightClient/index.js";
import {ExecutionPayloadBidPool} from "../../src/chain/opPools/executionPayloadBidPool.js";
import {AggregatedAttestationPool, OpPool, SyncContributionAndProofPool} from "../../src/chain/opPools/index.js";
import {ProposerPreferencesPool} from "../../src/chain/opPools/proposerPreferencesPool.js";
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
import {BuilderApiClient} from "../../src/execution/builder/apiClient.js";
import {ExecutionBuilderHttp} from "../../src/execution/builder/http.js";
import {ExecutionEngineHttp} from "../../src/execution/engine/index.js";
import {Clock} from "../../src/util/clock.js";
import {SerializedCache} from "../../src/util/serializedCache.js";
import {getMockedClock} from "./clock.js";
import {getMockedLogger} from "./loggerMock.js";

export type MockedBeaconChain = Mocked<BeaconChain> & {
  publishChainView: Mock<BeaconEngineCore["publishChainView"]>;
  logger: Mocked<Logger>;
  // The facade narrows `beaconEngine` to `IBeaconEngine`, but the flat mock doubles as the concrete
  // engine (`chain.beaconEngine = chain`), so tests invoke the `this: BeaconEngineCore` phantom validators
  // and reach engine internals (regen/bls/getHeadState) through it. Keep the concrete type here.
  beaconEngine: BeaconEngineCore;
  produceBlockWrapper: Mock<BeaconEngineCore["produceBlockWrapper"]>;
  forkChoice: MockedForkChoice;
  // Engine head-selection methods surfaced on the flat mock (the mock doubles as the engine, so the
  // real `prepareForNextSlot` bound onto it call `this.recomputeForkChoiceHead`
  // etc.). No longer on the facade — stubbed here so tests can control head selection.
  recomputeForkChoiceHead: Mock<(caller: ForkchoiceCaller) => ProtoBlock>;
  updateBuilderStatus: Mock<(slot: Slot) => void>;
  predictProposerHead: Mock<() => ProtoBlock>;
  getProposerHead: Mock<() => ProtoBlock>;
  executionEngine: Mocked<ExecutionEngineHttp>;
  executionBuilder: Mocked<ExecutionBuilderHttp>;
  builderCircuitBreaker: Mocked<BuilderCircuitBreaker>;
  proposerPreferencesPool: ProposerPreferencesPool;
  executionPayloadBidPool: Mocked<ExecutionPayloadBidPool>;
  builderApiClient: Mocked<BuilderApiClient>;
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
  // Engine state-read methods surfaced on the flat mock (the mock doubles as the engine). No longer on
  // the facade after BLK-3 — stubbed here so validation tests can control the head state.
  getHeadState: Mock<() => IBeaconStateView>;
  getHeadStateAtCurrentEpoch: Mock<() => Promise<IBeaconStateView>>;
  bls: {
    verifySignatureSets: Mock<BeaconEngineCore["bls"]["verifySignatureSets"]>;
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
      getSlotsPresent: vi.fn(),
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
      resumeFastConfirmation: vi.fn(),
      pauseFastConfirmation: vi.fn(),
      isDescendant: vi.fn(),
      hasBlock: vi.fn(),
      hasBlockHex: vi.fn(),
      getBlockSummariesAtSlot: vi.fn(),
      notifyPtcMessages: vi.fn(),
      shouldBuildOnFull: vi.fn(),
      getCanonicalPayloadCounts: vi.fn(),
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
      blockProductionCache: new Map(),
      getStatus: vi.fn().mockReturnValue({...ssz.phase0.Status.defaultValue(), earliestAvailableSlot: 0}),
      genesisTime,
      clock,
      forkChoice: getMockedForkChoice(),
      serializedCache: new SerializedCache({cacheDeserialized: true}),
      blockSerializedCache: new BlockSerializedCache(config),
      verifiedBlocks: new Map(),
      events: new BeaconEngineEventBus(),
      publishChainView: vi.fn(),
      executionEngine: {
        notifyForkchoiceUpdate: vi.fn(),
        getPayload: vi.fn(),
        getClientVersion: vi.fn(),
      },
      executionBuilder: {},
      proposerPreferencesPool: new ProposerPreferencesPool(),
      builderCircuitBreaker: {
        isActive: vi.fn(),
        update: vi.fn(),
      },
      executionPayloadBidPool: {
        add: vi.fn(),
        getBestBid: vi.fn(),
      },
      builderApiClient: {
        getExecutionPayloadBids: vi.fn().mockResolvedValue([]),
        submitBuilderPreferences: vi.fn(),
        submitSignedBeaconBlock: vi.fn(),
        checkStatus: vi.fn().mockResolvedValue(undefined),
      },
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
      isVerifiedProposerSignature: vi.fn().mockReturnValue(false),
      markVerifiedProposerSignature: vi.fn(),
      seenSyncCommitteeMessages: new SeenSyncCommitteeMessages(),
      seenContributionAndProof: new SeenContributionAndProof(null),
      seenAttestationDatas: new SeenAttestationDatas(null),
      payloadAttestationPool: {
        add: vi.fn(),
        getAll: vi.fn(),
        getPayloadAttestationsForBlock: vi.fn().mockReturnValue([]),
      },
      // @ts-expect-error
      beaconProposerCache: new BeaconProposerCache(),
      // @ts-expect-error
      seenBlockInputCache: new SeenBlockInput(),
      seenPayloadEnvelopeInputCache: {
        add: vi.fn(),
        get: vi.fn(),
        getOrReload: vi.fn(),
        remove: vi.fn(),
        removeInvalid: vi.fn(),
      },
      seenPayloadEnvelope: vi.fn(),
      shufflingCache: new ShufflingCache(),
      pubkeyCache,
      produceCommonBlockBody: vi.fn(),
      produceBlockV4: vi.fn(),
      produceBlockWrapper: vi.fn(),
      getProposerHead: vi.fn(),
      produceBlock: vi.fn(),
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
      updateAttachedValidators: vi.fn(),
      processBlock: vi.fn(),
      processProposerEquivocation: vi.fn(),
      persistInvalidSszValue: vi.fn(),
      persistExecutionPayloadEnvelope: vi.fn(),
      persistInvalidSszBytes: vi.fn(),
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
  // The gossip validators are now BeaconEngineCore methods that read engine collaborators. In this flat
  // mock the facade doubles as the engine, so `chain.beaconEngine.forkChoice === chain.forkChoice` etc.
  (chain as {beaconEngine: unknown}).beaconEngine = chain;
  // Duty flows are real BeaconEngineCore methods; bind the real implementations (and the private helpers
  // they call) so duty tests exercise real logic against the mock's collaborators.
  // `prepareForNextSlot` is a real BeaconEngineCore method too; `recomputeForkChoiceHead` / `predictProposerHead`
  // stay as mock fns above so tests can control head selection.
  for (const name of [
    "getLightClientServer",
    "getLightClientBootstrap",
    "getLightClientUpdate",
    "getLightClientOptimisticUpdate",
    "getLightClientFinalityUpdate",
    "getLightClientCommitteeRoot",
    "pruneLightClientNonCheckpointData",
    "validateGossipLightClientOptimisticUpdate",
    "validateGossipLightClientFinalityUpdate",
    "verifyBlocks",
    "validateApiBlock",
    "observeVerifiedBlocks",
    "markBlockProposersSeen",
    "discardVerifiedBlocks",
    "getProposerDuties",
    "getAttesterDuties",
    "getSyncCommitteeDuties",
    "getPtcDuties",
    "getHeadStateAtEpoch",
    "prepareForNextSlot",
    "getProposerTargetGasLimit",
    // Proposer cache + finalized balances bridges (forward to the mock's collaborators).
    "getProposerFeeRecipient",
    "updateProposerPreparation",
    "trackAttachedValidators",
    "getProposerCacheValidatorIndices",
    "getCheckpointEffectiveBalances",
    // Op-pool add/read bridges (forward to the mock's pools).
    "addAttestationToPool",
    "getAttestationAggregate",
    "getPoolAggregatedAttestations",
    "getSyncCommitteeContribution",
    "getPoolPayloadAttestations",
    "getPoolProposerPreferences",
    "registerLocalValidators",
    "registerLocalValidatorsInSyncCommittee",
    "registerApiBlock",
    "registerApiExecutionPayloadEnvelope",
    "onPoolSubmitUnaggregatedAttestation",
    "onPoolSubmitAggregatedAttestation",
    "getMonitoredValidatorIndices",
    "scrapeValidatorMonitorMetrics",
    // Fork-choice write wrappers (forward to the mock's forkChoice).
    "updateTime",
    // Developer API diagnostics (forward to the engine-owned fork choice).
    "getHeads",
    "getAllNodes",
    "getPTCVoteCounts",
    "getUnrealizedJustifiedCheckpoint",
    "getUnrealizedFinalizedCheckpoint",
    "getProposerBoostRoot",
    "getPreviousProposerBoostRoot",
    "getFastConfirmationStore",
    "getConfirmedBlock",
  ] as const) {
    (chain as unknown as Record<string, unknown>)[name] = (
      BeaconEngineCore.prototype as unknown as Record<string, unknown>
    )[name];
  }
  vi.spyOn(chain.proposerPreferencesPool, "get");
  chain.beaconEngine.prepareBeaconCommitteeSubnets = vi.fn().mockResolvedValue(undefined);
  for (const [name, forkChoiceName] of Object.entries({
    isDescendant: "isDescendant",
    getHead: "getHead",
    getHeadRoot: "getHeadRoot",
    getFinalizedCheckpoint: "getFinalizedCheckpoint",
    getJustifiedCheckpoint: "getJustifiedCheckpoint",
    getFinalizedBlock: "getFinalizedBlock",
    getJustifiedBlock: "getJustifiedBlock",
    hasBlock: "hasBlock",
    hasBlockHex: "hasBlockHex",
    hasBlockHexUnsafe: "hasBlockHexUnsafe",
    hasPayloadHexUnsafe: "hasPayloadHexUnsafe",
    getBlockDefaultStatus: "getBlockDefaultStatus",
    getBlockHexDefaultStatus: "getBlockHexDefaultStatus",
    getBlockHex: "getBlockHex",
    getBlockHexAndBlockHash: "getBlockHexAndBlockHash",
    getCanonicalProtoBlockAtSlot: "getCanonicalBlockAtSlot",
    getCanonicalBlockClosestLteSlot: "getCanonicalBlockClosestLteSlot",
    getCanonicalBlockByRoot: "getCanonicalBlockByRoot",
    getBlockSummariesAtSlot: "getBlockSummariesAtSlot",
    getBlockSummariesByParentRoot: "getBlockSummariesByParentRoot",
    getAllAncestorBlocks: "getAllAncestorBlocks",
  })) {
    (chain as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      const fn = (chain.forkChoice as unknown as Record<string, (...args: unknown[]) => unknown>)[forkChoiceName];
      return fn.apply(chain.forkChoice, args);
    };
  }
  return chain;
}

export type MockedForkChoice = Mocked<ForkChoice>;

export function getMockedForkChoice(): MockedForkChoice {
  // ForkChoice package is mocked globally
  return vi.mocked(new ForkChoice({} as any, {} as any, {} as any, {} as any, {} as any));
}

// To avoid loading the package in test while mocked, exporting frequently used types and constants
export {EpochDifference};
export type {ProtoBlock};
