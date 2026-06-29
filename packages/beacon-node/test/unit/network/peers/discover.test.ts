import {generateKeyPair} from "@libp2p/crypto/keys";
import {multiaddr} from "@multiformats/multiaddr";
import {describe, expect, it} from "vitest";
import {SignableENR} from "@chainsafe/enr";
import {config} from "@lodestar/config/default";
import {PeerDiscovery} from "../../../../src/network/peers/discover.js";
import {ScoreState} from "../../../../src/network/peers/score/interface.js";
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
    } as any;

    const discv5 = {on: () => {}, off: () => {}} as any;
    const peerRpcScores = {getScoreState: () => ScoreState.Healthy, isCoolingDown: () => false} as any;
    const clock = {currentSlot: 0, genesisTime: 0} as any;

    new PeerDiscovery(
      {libp2p, clock, peerRpcScores, metrics: null, logger, networkConfig: {config} as any},
      {discv5FirstQueryDelayMs: 0, discv5: {bootEnrs: [bootEnr]} as any, connectToDiscv5Bootnodes: true},
      discv5
    );

    // Allow the fire-and-forget onDiscoveredENR promise(s) to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    const errorMessages = logger.error.mock.calls.map((args) => String(args[0]));
    expect(errorMessages).not.toContain("Error onDiscovered");
  });
});
