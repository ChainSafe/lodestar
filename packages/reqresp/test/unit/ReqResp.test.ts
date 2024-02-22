import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {Libp2p} from "libp2p";
import {Logger} from "@lodestar/utils";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {RespStatus} from "../../src/interface.js";
import {ReqResp} from "../../src/ReqResp.js";
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

    it("should not register handler twice for same protocol if ignoreIfDuplicate=true", async () => {
      await reqresp.registerProtocol(numberToStringProtocol, {ignoreIfDuplicate: true});
      expect(libp2p.handle).toHaveBeenCalledOnce();

      await reqresp.registerProtocol(numberToStringProtocol, {ignoreIfDuplicate: true});
      expect(libp2p.handle).toHaveBeenCalledOnce();
    });
  });
});
