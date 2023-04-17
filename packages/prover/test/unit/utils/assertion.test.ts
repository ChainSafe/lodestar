import {expect} from "chai";
import {ethers} from "ethers";
import Web3 from "web3";
import {isSendProvider} from "../../../src/utils/assertion.js";

describe("utils/assertion", () => {
  describe("isSendProvider", () => {
    it("should return true if provider is SendProvider", () => {
      const provider = {
        send: (_payload: any, _cb: () => void) => {
          // Do nothing;
        },
      };
      expect(isSendProvider(provider)).to.be.true;
    });

    it("should return false for ethers provider", () => {
      const provider = new ethers.JsonRpcProvider("");
      expect(isSendProvider(provider)).to.be.false;
    });

    it("should return true for web3 provider", () => {
      const provider = new Web3.providers.HttpProvider("");
      expect(isSendProvider(provider)).to.be.true;
    });
  });
});
