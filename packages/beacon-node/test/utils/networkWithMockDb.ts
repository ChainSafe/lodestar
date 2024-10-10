import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {ChainForkConfig, createBeaconConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {BeaconChain} from "../../src/chain/chain.js";
import {Eth1ForBlockProductionDisabled} from "../../src/eth1/index.js";
import {ExecutionEngineDisabled} from "../../src/execution/index.js";
import {GossipHandlers, Network, NetworkInitModules, getReqRespHandlers} from "../../src/network/index.js";
import {NetworkOptions, defaultNetworkOptions} from "../../src/network/options.js";
import {GetReqRespHandlerFn} from "../../src/network/reqresp/types.js";
import {getMockedBeaconDb} from "../mocks/mockedBeaconDb.js";
import {createCachedBeaconStateTest} from "./cachedBeaconState.js";
import {ClockStatic} from "./clock.js";
import {testLogger} from "./logger.js";
import {generateState} from "./state.js";

export type NetworkForTestOpts = {
  startSlot?: number;
  opts?: Partial<NetworkOptions>;
  gossipHandlersPartial?: Partial<GossipHandlers>;
  getReqRespHandler?: GetReqRespHandlerFn;
};

export async function getNetworkForTest(
  loggerId: string,
  config: ChainForkConfig,
  opts: NetworkForTestOpts
): Promise<[network: Network, closeAll: () => Promise<void>]> {
  const logger = testLogger(loggerId);
  const startSlot = opts.startSlot ?? 0;

  const block = ssz.phase0.SignedBeaconBlock.defaultValue();
  const state = generateState(
    {
      slot: startSlot,
      finalizedCheckpoint: {
        epoch: 0,
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    },
    config
  );

  const beaconConfig = createBeaconConfig(config, state.genesisValidatorsRoot);
  const db = getMockedBeaconDb();

  const chain = new BeaconChain(
    {
      safeSlotsToImportOptimistically: 0,
      suggestedFeeRecipient: "",
      blsVerifyAllMainThread: true,
      disableOnBlockError: true,
      disableArchiveOnCheckpoint: true,
      disableLightClientServerOnImportBlockHead: true,
      disablePrepareNextSlot: true,
      minSameMessageSignatureSetsToBatch: 32,
    },
    {
      config: beaconConfig,
      db,
      logger,
      processShutdownCallback: () => {},
      // set genesis time so that we are at ALTAIR_FORK_EPOCH
      // mock timer does not work on worker thread
      clock: new ClockStatic(startSlot, Math.floor(Date.now() / 1000) - startSlot * beaconConfig.SECONDS_PER_SLOT),
      metrics: null,
      anchorState: createCachedBeaconStateTest(state, beaconConfig),
      eth1: new Eth1ForBlockProductionDisabled(),
      executionEngine: new ExecutionEngineDisabled(),
    }
  );

  const modules: Omit<NetworkInitModules, "opts" | "peerId" | "logger"> = {
    config: beaconConfig,
    chain,
    db,
    getReqRespHandler: opts.getReqRespHandler ?? getReqRespHandlers({db, chain}),
    gossipHandlers: opts.gossipHandlersPartial as GossipHandlers,
    metrics: null,
  };

  const network = await Network.init({
    ...modules,
    peerId: await createSecp256k1PeerId(),
    opts: {
      ...defaultNetworkOptions,
      maxPeers: 1,
      targetPeers: 1,
      bootMultiaddrs: [],
      localMultiaddrs: ["/ip4/127.0.0.1/tcp/0"],
      discv5FirstQueryDelayMs: 0,
      discv5: null,
      skipParamsLog: true,
      // Disable rate limiting
      rateLimitMultiplier: 0,
      ...opts.opts,
    },
    logger,
  });

  return [
    network,
    async function closeAll() {
      await network.close();
      await chain.close();
    },
  ];
}
