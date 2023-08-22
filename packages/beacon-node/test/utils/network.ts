import {PeerId} from "@libp2p/interface/peer-id";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {BitArray} from "@chainsafe/ssz";
import {ATTESTATION_SUBNET_COUNT, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ChainForkConfig, createBeaconConfig} from "@lodestar/config";
import {
  GossipHandlers,
  INetwork,
  Network,
  NetworkEvent,
  NetworkInitModules,
  getReqRespHandlers,
} from "../../src/network/index.js";
import {createNodeJsLibp2p} from "../../src/network/libp2p/index.js";
import {Libp2p} from "../../src/network/interface.js";
import {GetReqRespHandlerFn} from "../../src/network/reqresp/types.js";
import {Eth1ForBlockProductionDisabled} from "../../src/eth1/index.js";
import {defaultNetworkOptions, NetworkOptions} from "../../src/network/options.js";
import {BeaconChain} from "../../src/chain/chain.js";
import {ExecutionEngineDisabled} from "../../src/execution/index.js";
import {PeerIdStr} from "../../src/util/peerId.js";
import {testLogger} from "./logger.js";
import {generateState} from "./state.js";
import {getStubbedBeaconDb} from "./mocks/db.js";
import {ClockStatic} from "./clock.js";
import {createCachedBeaconStateTest} from "./cachedBeaconState.js";

export async function createNode(multiaddr: string, inPeerId?: PeerId): Promise<Libp2p> {
  const peerId = inPeerId || (await createSecp256k1PeerId());
  return createNodeJsLibp2p(peerId, {localMultiaddrs: [multiaddr]});
}

export async function createNetworkModules(
  multiaddr: string,
  peerId?: PeerId,
  opts?: Partial<NetworkOptions>
): Promise<{opts: NetworkOptions; peerId: PeerId}> {
  return {
    peerId: peerId ?? (await createSecp256k1PeerId()),
    opts: {...defaultNetworkOptions, ...opts, localMultiaddrs: [multiaddr]},
  };
}

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
  const db = getStubbedBeaconDb();

  const chain = new BeaconChain(
    {
      safeSlotsToImportOptimistically: 0,
      archiveStateEpochFrequency: 0,
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
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      processShutdownCallback: () => {},
      // set genesis time so that we are at ALTAIR_FORK_EPOCH
      // sinon mock timer does not work on worker thread
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
      await chain.close();
      await network.close();
    },
  ];
}

export async function getPeerIdOf(net: INetwork): Promise<PeerIdStr> {
  return (await net.getNetworkIdentity()).peerId;
}

/**
 * TEMP: Only request required props from INetwork do to this type isse
 */
type INetworkDebug = Pick<INetwork, "connectToPeer" | "disconnectPeer" | "getNetworkIdentity">;

// Helpers to manipulate network's libp2p instance for testing only

export async function connect(netDial: INetworkDebug, netServer: INetworkDebug): Promise<void> {
  const netServerId = await netServer.getNetworkIdentity();
  await netDial.connectToPeer(netServerId.peerId, netServerId.p2pAddresses);
}

export async function disconnect(network: INetworkDebug, peer: string): Promise<void> {
  await network.disconnectPeer(peer);
}

export function onPeerConnect(network: Network): Promise<void> {
  return new Promise<void>((resolve) => network.events.on(NetworkEvent.peerConnected, () => resolve()));
}

export function onPeerDisconnect(network: Network): Promise<void> {
  return new Promise<void>((resolve) => network.events.on(NetworkEvent.peerDisconnected, () => resolve()));
}

/**
 * Generate valid filled attnets BitVector
 */
export function getAttnets(subnetIds: number[] = []): BitArray {
  const attnets = BitArray.fromBitLen(ATTESTATION_SUBNET_COUNT);
  for (const subnetId of subnetIds) {
    attnets.set(subnetId, true);
  }
  return attnets;
}

/**
 * Generate valid filled syncnets BitVector
 */
export function getSyncnets(subnetIds: number[] = []): BitArray {
  const syncnets = BitArray.fromBitLen(SYNC_COMMITTEE_SUBNET_COUNT);
  for (const subnetId of subnetIds) {
    syncnets.set(subnetId, true);
  }
  return syncnets;
}
