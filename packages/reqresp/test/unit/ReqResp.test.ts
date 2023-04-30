import {expect} from "chai";
import {Libp2p} from "libp2p";
import sinon from "sinon";
import {Logger} from "@lodestar/utils";
import {RespStatus} from "../../src/interface.js";
import {ReqResp} from "../../src/ReqResp.js";
import {getEmptyHandler, sszSnappyPing} from "../fixtures/messages.js";
import {numberToStringProtocol, numberToStringProtocolDialOnly, pingProtocol} from "../fixtures/protocols.js";
import {createStubbedLogger} from "../mocks/logger.js";
import {MockLibP2pStream} from "../utils/index.js";
import {responseEncode} from "../utils/response.js";

describe("ResResp", () => {
  let reqresp: ReqResp;
  let libp2p: Libp2p;
  let logger: Logger;
  const ping = pingProtocol(getEmptyHandler());

  beforeEach(() => {
    libp2p = {
      dialProtocol: sinon.stub().resolves(
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
      handle: sinon.spy(),
    } as unknown as Libp2p;

    logger = createStubbedLogger();

    reqresp = new ReqResp({
      libp2p,
      logger,
      metricsRegister: null,
    });
  });

  describe("dial only protocol", () => {
    it("should register protocol and dial", async () => {
      reqresp.registerDialOnlyProtocol(numberToStringProtocolDialOnly);

      expect(reqresp.getRegisteredProtocols()).to.eql(["/eth2/beacon_chain/req/number_to_string/1/ssz_snappy"]);
      expect((libp2p.handle as sinon.SinonSpy).calledOnce).to.be.false;
    });
  });

  describe("duplex protocol", () => {
    it("should register protocol and dial", async () => {
      await reqresp.registerProtocol(numberToStringProtocol);

      expect(reqresp.getRegisteredProtocols()).to.eql(["/eth2/beacon_chain/req/number_to_string/1/ssz_snappy"]);
      expect((libp2p.handle as sinon.SinonSpy).calledOnce).to.be.true;
    });
  });
});
