import {generateKeyPair} from "@libp2p/crypto/keys";
import {multiaddr} from "@multiformats/multiaddr";
import {beforeEach, describe, expect, it} from "vitest";
import {SignableENR} from "@chainsafe/enr";
import {parseDirectPeers} from "../../../../src/network/gossip/gossipsub.js";
import {MockedLogger, getMockedLogger} from "../../../mocks/loggerMock.js";

describe("network / gossip / directPeers", () => {
  let logger: MockedLogger;

  beforeEach(() => {
    logger = getMockedLogger();
  });

  describe("parseDirectPeers", () => {
    it("should parse valid multiaddr with peer ID", () => {
      const peerIdStr = "16Uiu2HAkuWPWqF4W3aw9oo5Yw79v5muzBaaGTGKMmuqjPfEyfkwu";
      const multiaddrs = [`/ip4/192.168.1.1/tcp/9000/p2p/${peerIdStr}`];

      const result = parseDirectPeers(multiaddrs, logger);

      expect(result).toHaveLength(1);
      expect(result[0].id.toString()).toBe(peerIdStr);
      expect(result[0].addrs).toHaveLength(1);
      expect(result[0].addrs[0].toString()).toBe("/ip4/192.168.1.1/tcp/9000");
      expect(logger.info).toHaveBeenCalledWith("Added direct peer", {
        peerId: peerIdStr,
        addr: "/ip4/192.168.1.1/tcp/9000",
      });
    });

    it("should parse multiple valid multiaddrs", () => {
      const peerIdStr1 = "16Uiu2HAkuWPWqF4W3aw9oo5Yw79v5muzBaaGTGKMmuqjPfEyfkwu";
      const peerIdStr2 = "16Uiu2HAmKLhW7HiWkVNSbsZjThQTiMAqDptiqyE8FRWsRz6e8WPF";
      const multiaddrs = [`/ip4/192.168.1.1/tcp/9000/p2p/${peerIdStr1}`, `/ip6/::1/tcp/9001/p2p/${peerIdStr2}`];

      const result = parseDirectPeers(multiaddrs, logger);

      expect(result).toHaveLength(2);
      expect(result[0].id.toString()).toBe(peerIdStr1);
      expect(result[0].addrs[0].toString()).toBe("/ip4/192.168.1.1/tcp/9000");
      expect(result[1].id.toString()).toBe(peerIdStr2);
      expect(result[1].addrs[0].toString()).toBe("/ip6/::1/tcp/9001");
    });

    it("should skip multiaddr without peer ID and log warning", () => {
      const multiaddrs = ["/ip4/192.168.1.1/tcp/9000"];

      const result = parseDirectPeers(multiaddrs, logger);

      expect(result).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith("Direct peer multiaddr must contain /p2p/ component with peer ID", {
        multiaddr: "/ip4/192.168.1.1/tcp/9000",
      });
    });

    it("should skip invalid multiaddr and log warning", () => {
      const multiaddrs = ["not-a-valid-multiaddr"];

      const result = parseDirectPeers(multiaddrs, logger);

      expect(result).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to parse direct peer multiaddr",
        {multiaddr: "not-a-valid-multiaddr"},
        expect.any(Error)
      );
    });

    it("should handle empty array", () => {
      const result = parseDirectPeers([], logger);

      expect(result).toHaveLength(0);
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should parse valid peers and skip invalid ones", () => {
      const peerIdStr = "16Uiu2HAkuWPWqF4W3aw9oo5Yw79v5muzBaaGTGKMmuqjPfEyfkwu";
      const multiaddrs = [
        `/ip4/192.168.1.1/tcp/9000/p2p/${peerIdStr}`,
        "/ip4/192.168.1.2/tcp/9000", // missing peer ID
        "invalid",
      ];

      const result = parseDirectPeers(multiaddrs, logger);

      expect(result).toHaveLength(1);
      expect(result[0].id.toString()).toBe(peerIdStr);
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it("should handle DNS multiaddr with peer ID", () => {
      const peerIdStr = "16Uiu2HAkuWPWqF4W3aw9oo5Yw79v5muzBaaGTGKMmuqjPfEyfkwu";
      const multiaddrs = [`/dns4/node.example.com/tcp/9000/p2p/${peerIdStr}`];

      const result = parseDirectPeers(multiaddrs, logger);

      expect(result).toHaveLength(1);
      expect(result[0].id.toString()).toBe(peerIdStr);
      expect(result[0].addrs[0].toString()).toBe("/dns4/node.example.com/tcp/9000");
    });

    it("should parse valid ENR with TCP multiaddr", async () => {
      const privateKey = await generateKeyPair("secp256k1");
      const enr = SignableENR.createFromPrivateKey(privateKey);
      enr.setLocationMultiaddr(multiaddr("/ip4/192.168.1.1/tcp/9000"));
      const enrStr = enr.encodeTxt();

      const result = parseDirectPeers([enrStr], logger);

      expect(result).toHaveLength(1);
      expect(result[0].id.toString()).toBe(enr.peerId.toString());
      expect(result[0].addrs).toHaveLength(1);
      expect(result[0].addrs[0].toString()).toBe("/ip4/192.168.1.1/tcp/9000");
      expect(logger.info).toHaveBeenCalledWith("Added direct peer from ENR", {
        peerId: enr.peerId.toString(),
        addr: "/ip4/192.168.1.1/tcp/9000",
      });
    });

    it("should skip ENR without TCP multiaddr and log warning", async () => {
      const privateKey = await generateKeyPair("secp256k1");
      const enr = SignableENR.createFromPrivateKey(privateKey);
      // Only set UDP, not TCP
      enr.setLocationMultiaddr(multiaddr("/ip4/192.168.1.1/udp/9000"));
      const enrStr = enr.encodeTxt();

      const result = parseDirectPeers([enrStr], logger);

      expect(result).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith("ENR does not contain TCP multiaddr", {enr: enrStr});
    });

    it("should skip invalid ENR and log warning", () => {
      const invalidEnr = "enr:-invalid-enr-string";

      const result = parseDirectPeers([invalidEnr], logger);

      expect(result).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith("Failed to parse direct peer ENR", {enr: invalidEnr}, expect.any(Error));
    });

    it("should parse mixed multiaddrs and ENRs", async () => {
      const peerIdStr = "16Uiu2HAkuWPWqF4W3aw9oo5Yw79v5muzBaaGTGKMmuqjPfEyfkwu";
      const privateKey = await generateKeyPair("secp256k1");
      const enr = SignableENR.createFromPrivateKey(privateKey);
      enr.setLocationMultiaddr(multiaddr("/ip4/10.0.0.1/tcp/9001"));
      const enrStr = enr.encodeTxt();

      const mixedPeers = [`/ip4/192.168.1.1/tcp/9000/p2p/${peerIdStr}`, enrStr];

      const result = parseDirectPeers(mixedPeers, logger);

      expect(result).toHaveLength(2);
      expect(result[0].id.toString()).toBe(peerIdStr);
      expect(result[0].addrs[0].toString()).toBe("/ip4/192.168.1.1/tcp/9000");
      expect(result[1].id.toString()).toBe(enr.peerId.toString());
      expect(result[1].addrs[0].toString()).toBe("/ip4/10.0.0.1/tcp/9001");
    });
  });
});
