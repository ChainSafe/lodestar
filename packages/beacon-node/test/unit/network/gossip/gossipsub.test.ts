import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {describe, expect, it, vi} from "vitest";
import {getMaxInboundDataLength, hangUpOnPeerReadStreamError} from "../../../../src/network/gossip/gossipsub.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

describe("network / gossip / gossipsub", () => {
  describe("getMaxInboundDataLength", () => {
    it("should match spec max_message_size() for mainnet MAX_PAYLOAD_SIZE", () => {
      // max_compressed_len(10 MiB) + 1024 = 32 + 10485760 + 1747626 + 1024
      expect(getMaxInboundDataLength({MAX_PAYLOAD_SIZE: 10 * 2 ** 20})).toBe(12234442);
    });

    it("should floor at 1 MiB for a small MAX_PAYLOAD_SIZE", () => {
      expect(getMaxInboundDataLength({MAX_PAYLOAD_SIZE: 1000})).toBe(1024 * 1024);
    });

    it("should exceed the it-length-prefixed default of 4 MiB on mainnet", () => {
      expect(getMaxInboundDataLength({MAX_PAYLOAD_SIZE: 10 * 2 ** 20})).toBeGreaterThan(4 * 2 ** 20);
    });
  });

  describe("hangUpOnPeerReadStreamError", () => {
    it("should call the original handler and hang up the peer", async () => {
      const peerId = peerIdFromPrivateKey(await generateKeyPair("secp256k1"));
      const originalHandler = vi.fn();
      const gossipsub = {handlePeerReadStreamError: originalHandler};
      const hangUp = vi.fn().mockResolvedValue(undefined);
      const logger = getMockedLogger();
      const err = new Error("Message length too long");

      hangUpOnPeerReadStreamError(gossipsub, {hangUp}, logger);
      gossipsub.handlePeerReadStreamError(err, peerId);

      expect(originalHandler).toHaveBeenCalledWith(err, peerId);
      expect(hangUp).toHaveBeenCalledWith(peerId);
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it("should not throw if hanging up fails", async () => {
      const peerId = peerIdFromPrivateKey(await generateKeyPair("secp256k1"));
      const gossipsub = {handlePeerReadStreamError: vi.fn()};
      const hangUp = vi.fn().mockRejectedValue(new Error("not connected"));
      const logger = getMockedLogger();

      hangUpOnPeerReadStreamError(gossipsub, {hangUp}, logger);
      gossipsub.handlePeerReadStreamError(new Error("boom"), peerId);
      await new Promise((resolve) => setImmediate(resolve));

      expect(hangUp).toHaveBeenCalledWith(peerId);
      expect(logger.debug).toHaveBeenCalledOnce();
    });
  });
});
