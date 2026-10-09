import {generateKeyPair} from "@libp2p/crypto/keys";
import {multiaddr} from "@multiformats/multiaddr";
import {describe, expect, it} from "vitest";
import {SignableENR} from "@chainsafe/enr";
import {config} from "@lodestar/config/default";
import type {LoggerNode} from "@lodestar/logger/node";
import type {Discv5Worker} from "../../../../src/network/discv5/index.js";
import type {LodestarDiscv5Opts} from "../../../../src/network/discv5/types.js";
import type {Libp2p} from "../../../../src/network/interface.js";
import type {NetworkConfig} from "../../../../src/network/networkConfig.js";
import {
  PeerDiscovery,
  type PeerDiscoveryModules,
  type PeerDiscoveryOpts,
} from "../../../../src/network/peers/discover.js";
import {type IPeerRpcScoreStore, ScoreState} from "../../../../src/network/peers/score/index.js";
import type {IClock} from "../../../../src/util/clock.js";
import {peerIdFromString} from "../../../../src/util/peerId.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {getValidPeerId} from "../../../utils/peer.js";

describe("network / peers / discover", () => {
  it("PeerId API", () => {
    const peerId = getValidPeerId();
    const peerIdStr = peerId.toString();
    const peerFromHex = peerIdFromString(peerIdStr);
    expect(peerFromHex.toString()).toBe(peerIdStr);
  });

  // Regression test for https://github.com/ChainSafe/lodestar/pull/9560
  // When network.connectToDiscv5Bootnodes is enabled, the constructor synchronously processes the
  // bootENRs (onDiscoveredENR -> handleDiscoveredPeer), which reads this.transports. Previously
  // this.transports was assigned at the END of the constructor, so it was still undefined during
  // bootENR processing and handleDiscoveredPeer threw
  // "Cannot read properties of undefined (reading 'includes')" (caught + logged as "Error onDiscovered"),
  // meaning the node never dialed its bootnodes on startup.
  it("processes bootENRs at construction without throwing on undefined transports", async () => {
    const logger = getMockedLogger();

    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);
    enr.setLocationMultiaddr(multiaddr("/ip4/127.0.0.1/tcp/9000"));
    const bootEnr = enr.encodeTxt();

    const libp2p = {
      addEventListener: () => {},
      services: {
        components: {
          transportManager: {getTransports: () => [{[Symbol.toStringTag]: "@libp2p/tcp"}]},
          connectionManager: {getConnectionsMap: () => ({map: new Map()}), getDialQueue: () => []},
        },
      },
    } as unknown as Libp2p;

    const modules: PeerDiscoveryModules = {
      privateKey,
      networkConfig: {config} as unknown as NetworkConfig,
      libp2p,
      clock: {currentSlot: 0, genesisTime: 0} as unknown as IClock,
      peerRpcScores: {
        getScoreState: () => ScoreState.Healthy,
        isCoolingDown: () => false,
      } as unknown as IPeerRpcScoreStore,
      metrics: null,
      logger: logger as unknown as LoggerNode,
    };
    const opts: PeerDiscoveryOpts = {
      discv5FirstQueryDelayMs: 0,
      discv5: {bootEnrs: [bootEnr]} as unknown as LodestarDiscv5Opts,
      connectToDiscv5Bootnodes: true,
    };
    const discv5 = {on: () => {}, off: () => {}} as unknown as Discv5Worker;

    new PeerDiscovery(modules, opts, discv5);

    // Allow the fire-and-forget onDiscoveredENR promise(s) to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    const errorMessages = logger.error.mock.calls.map((args) => String(args[0]));
    expect(errorMessages).not.toContain("Error onDiscovered");
  });

  // Regression test for https://github.com/ChainSafe/lodestar/issues/10256
  // A discovered ENR that advertises both IPv4 and IPv6 endpoints must keep both
  // families as dial candidates. Previously only the IPv4 multiaddr per transport
  // reached the peer store, so the peer was undialable when IPv4 was unreachable.
  it("preserves both IPv4 and IPv6 dial candidates from a dual-stack bootENR", async () => {
    const logger = getMockedLogger();

    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);
    enr.setLocationMultiaddr(multiaddr("/ip4/127.0.0.1/tcp/9000"));
    enr.setLocationMultiaddr(multiaddr("/ip6/::1/tcp/9000"));
    enr.setLocationMultiaddr(multiaddr("/ip4/127.0.0.1/udp/9000/quic-v1"));
    enr.setLocationMultiaddr(multiaddr("/ip6/::1/udp/9000/quic-v1"));
    const bootEnr = enr.encodeTxt();

    const mergedMultiaddrs: string[] = [];
    const libp2p = {
      addEventListener: () => {},
      dial: async () => {},
      peerStore: {
        merge: async (_peerId: unknown, opts: {multiaddrs: {toString: () => string}[]}) => {
          mergedMultiaddrs.push(...opts.multiaddrs.map((ma) => ma.toString()));
          return {addresses: opts.multiaddrs.map((multiaddr) => ({multiaddr}))};
        },
      },
      services: {
        components: {
          transportManager: {
            getTransports: () => [{[Symbol.toStringTag]: "@libp2p/tcp"}, {[Symbol.toStringTag]: "quic"}],
          },
          connectionManager: {getConnectionsMap: () => ({map: new Map()}), getDialQueue: () => []},
        },
      },
    } as unknown as Libp2p;

    const modules: PeerDiscoveryModules = {
      privateKey,
      networkConfig: {config} as unknown as NetworkConfig,
      libp2p,
      clock: {currentSlot: 0, genesisTime: 0} as unknown as IClock,
      peerRpcScores: {
        getScoreState: () => ScoreState.Healthy,
        isCoolingDown: () => false,
      } as unknown as IPeerRpcScoreStore,
      metrics: null,
      logger: logger as unknown as LoggerNode,
    };
    const opts: PeerDiscoveryOpts = {
      discv5FirstQueryDelayMs: 0,
      discv5: {bootEnrs: [bootEnr]} as unknown as LodestarDiscv5Opts,
      connectToDiscv5Bootnodes: true,
    };
    const discv5 = {on: () => {}, off: () => {}} as unknown as Discv5Worker;

    const discovery = new PeerDiscovery(modules, opts, discv5);

    // Allow the fire-and-forget onDiscoveredENR promise(s) to settle so the peer is cached
    await new Promise((resolve) => setTimeout(resolve, 50));

    discovery.discoverPeers(1, new Map());

    // Allow the fire-and-forget dialPeer promise to reach peerStore.merge
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mergedMultiaddrs).toContain("/ip4/127.0.0.1/tcp/9000");
    expect(mergedMultiaddrs).toContain("/ip6/::1/tcp/9000");
    expect(mergedMultiaddrs).toContain("/ip4/127.0.0.1/udp/9000/quic-v1");
    expect(mergedMultiaddrs).toContain("/ip6/::1/udp/9000/quic-v1");
  });
});
