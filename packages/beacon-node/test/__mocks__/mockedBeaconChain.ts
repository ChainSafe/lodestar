/* eslint-disable @typescript-eslint/naming-convention */
import {vi, MockedObject, Mock} from "vitest";
import {ForkChoice} from "@lodestar/fork-choice";
import {config as defaultConfig} from "@lodestar/config/default";
import {ChainForkConfig} from "@lodestar/config";
import {BeaconChain} from "../../src/chain/index.js";
import {ExecutionEngineHttp} from "../../src/execution/engine/http.js";
import {ExecutionBuilderHttp} from "../../src/execution/builder/http.js";
import {Eth1ForBlockProduction} from "../../src/eth1/index.js";
import {OpPool} from "../../src/chain/opPools/opPool.js";
import {AggregatedAttestationPool} from "../../src/chain/opPools/aggregatedAttestationPool.js";
import {BeaconProposerCache} from "../../src/chain/beaconProposerCache.js";
import {QueuedStateRegenerator} from "../../src/chain/regen/index.js";
import {LightClientServer} from "../../src/chain/lightClient/index.js";
import {Clock} from "../../src/util/clock.js";
import {ShufflingCache} from "../../src/chain/shufflingCache.js";
import {getMockedLogger} from "./loggerMock.js";

export type MockedBeaconChain = MockedObject<BeaconChain> & {
  getHeadState: Mock<[]>;
  forkChoice: MockedObject<ForkChoice>;
  executionEngine: MockedObject<ExecutionEngineHttp>;
  executionBuilder: MockedObject<ExecutionBuilderHttp>;
  eth1: MockedObject<Eth1ForBlockProduction>;
  opPool: MockedObject<OpPool>;
  aggregatedAttestationPool: MockedObject<AggregatedAttestationPool>;
  beaconProposerCache: MockedObject<BeaconProposerCache>;
  shufflingCache: MockedObject<ShufflingCache>;
  regen: MockedObject<QueuedStateRegenerator>;
  bls: {
    verifySignatureSets: Mock<[boolean]>;
    verifySignatureSetsSameMessage: Mock<[boolean]>;
    close: Mock;
    canAcceptWork: Mock<[boolean]>;
  };
  lightClientServer: MockedObject<LightClientServer>;
};
vi.mock("@lodestar/fork-choice");
vi.mock("../../src/execution/engine/http.js");
vi.mock("../../src/execution/builder/http.js");
vi.mock("../../src/eth1/index.js");
vi.mock("../../src/chain/opPools/opPool.js");
vi.mock("../../src/chain/opPools/aggregatedAttestationPool.js");
vi.mock("../../src/chain/beaconProposerCache.js");
vi.mock("../../src/chain/shufflingCache.js");
vi.mock("../../src/chain/regen/index.js");
vi.mock("../../src/chain/lightClient/index.js");
vi.mock("../../src/chain/index.js", async (requireActual) => {
  const mod = await requireActual<typeof import("../../src/chain/index.js")>();

  const BeaconChain = vi.fn().mockImplementation(({clock, genesisTime, config}: MockedBeaconChainOptions) => {
    return {
      config,
      opts: {},
      genesisTime,
      clock:
        clock === "real"
          ? new Clock({config, genesisTime: 0, signal: new AbortController().signal})
          : {
              currentSlot: undefined,
              currentSlotWithGossipDisparity: undefined,
              isCurrentSlotGivenGossipDisparity: vi.fn(),
            },
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      forkChoice: new ForkChoice(),
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      executionEngine: new ExecutionEngineHttp(),
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      executionBuilder: new ExecutionBuilderHttp(),
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      eth1: new Eth1ForBlockProduction(),
      opPool: new OpPool(),
      aggregatedAttestationPool: new AggregatedAttestationPool(),
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      beaconProposerCache: new BeaconProposerCache(),
      shufflingCache: new ShufflingCache(),
      produceBlock: vi.fn(),
      produceBlindedBlock: vi.fn(),
      getBlockRewards: vi.fn(),
      getCanonicalBlockAtSlot: vi.fn(),
      recomputeForkChoiceHead: vi.fn(),
      getHeadStateAtCurrentEpoch: vi.fn(),
      getHeadState: vi.fn(),
      updateBuilderStatus: vi.fn(),
      processBlock: vi.fn(),
      regenStateForAttestationVerification: vi.fn(),
      close: vi.fn(),
      logger: getMockedLogger(),
      regen: new QueuedStateRegenerator({} as any),
      lightClientServer: new LightClientServer({} as any, {} as any),
      bls: {
        verifySignatureSets: vi.fn().mockResolvedValue(true),
        verifySignatureSetsSameMessage: vi.fn().mockResolvedValue([true]),
        close: vi.fn().mockResolvedValue(true),
        canAcceptWork: vi.fn().mockReturnValue(true),
      },
      emitter: new mod.ChainEventEmitter(),
    };
  });

  return {
    ...mod,
    BeaconChain,
  };
});

type MockedBeaconChainOptions = {
  clock: "real" | "fake";
  genesisTime: number;
  config: ChainForkConfig;
};

export function getMockedBeaconChain(opts?: Partial<MockedBeaconChainOptions>): MockedBeaconChain {
  const {clock, genesisTime, config} = opts ?? {};
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  return new BeaconChain({
    clock: clock ?? "fake",
    genesisTime: genesisTime ?? 0,
    config: config ?? defaultConfig,
  }) as MockedBeaconChain;
}
