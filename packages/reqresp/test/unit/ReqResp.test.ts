import {Libp2p} from "libp2p";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {Logger} from "@lodestar/utils";
import {RespStatus} from "../../src/interface.js";
import {ReqResp} from "../../src/ReqResp.js";
import {RateLimiterQuota} from "../../src/rate_limiter/rateLimiterGRCA.js";
import {Protocol} from "../../src/types.js";
import {getEmptyHandler, sszSnappyPing} from "../fixtures/messages.js";
import {numberToStringProtocol, numberToStringProtocolDialOnly, pingProtocol} from "../fixtures/protocols.js";
import {MockLibP2pStream} from "../utils/index.js";
import {responseEncode} from "../utils/response.js";

describe("ResResp", () => {
  let reqresp: ReqResp;
  let libp2p: Libp2p;
  let logger: Logger;
  const ping = pingProtocol(getEmptyHandler());

  beforeEach(() => {
    libp2p = {
      dialProtocol: vi.fn().mockResolvedValue(
        new MockLibP2pStream(
          responseEncode(
            [
              {
                status: RespStatus.SUCCESS,
                payload: sszSnappyPing.binaryPayload,
              },
            ],
            ping
          ),
          ping.method
        )
      ),
      handle: vi.fn(),
    } as unknown as Libp2p;

    logger = getEmptyLogger();

    reqresp = new ReqResp({
      libp2p,
      logger,
      metricsRegister: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("dial only protocol", () => {
    it("should register protocol and dial", async () => {
      reqresp.registerDialOnlyProtocol(numberToStringProtocolDialOnly);

      expect(reqresp.getRegisteredProtocols()).toEqual(["/eth2/beacon_chain/req/number_to_string/1/ssz_snappy"]);
      expect(libp2p.handle).not.toHaveBeenCalledOnce();
    });
  });

  describe("duplex protocol", () => {
    it("should register protocol and dial", async () => {
      await reqresp.registerProtocol(numberToStringProtocol);

      expect(reqresp.getRegisteredProtocols()).toEqual(["/eth2/beacon_chain/req/number_to_string/1/ssz_snappy"]);
      expect(libp2p.handle).toHaveBeenCalledOnce();
    });

    it("should override existing handler if same protocol is registered multiple times", async () => {
      await reqresp.registerProtocol(numberToStringProtocol);
      expect(libp2p.handle).toHaveBeenCalledOnce();

      await reqresp.registerProtocol(numberToStringProtocol);
      expect(libp2p.handle).toHaveBeenCalledTimes(2);

      await reqresp.registerProtocol(numberToStringProtocol);
      expect(libp2p.handle).toHaveBeenCalledTimes(3);
    });

    it("should apply new rate limits if same protocol is registered with different limits", async () => {
      // Initial registration of protocol
      const {quota, quotaTimeMs} = numberToStringProtocol.inboundRateLimits?.byPeer as RateLimiterQuota;
      const initialMsPerToken = quotaTimeMs / quota;
      await reqresp.registerProtocol(numberToStringProtocol);
      const initialLimit = reqresp["rateLimiter"]["rateLimitersPerPeer"].get(
        "/eth2/beacon_chain/req/number_to_string/1/ssz_snappy"
      );
      // Sanity check expected value
      expect(initialLimit?.["msPerToken"]).toBe(initialMsPerToken);

      // Register same protocol with new by peer rate limits
      const updatedQuota: RateLimiterQuota = {quota: 10, quotaTimeMs: 15_000};
      const updatedProtocol: Protocol = {
        ...numberToStringProtocol,
        inboundRateLimits: {byPeer: updatedQuota},
      };
      const updatedMsPerToken = updatedQuota.quotaTimeMs / updatedQuota.quota;
      await reqresp.registerProtocol(updatedProtocol);
      const updatedLimit = reqresp["rateLimiter"]["rateLimitersPerPeer"].get(
        "/eth2/beacon_chain/req/number_to_string/1/ssz_snappy"
      );
      // New limits should be applied
      expect(updatedLimit?.["msPerToken"]).toBe(updatedMsPerToken);
    });
  });
});
