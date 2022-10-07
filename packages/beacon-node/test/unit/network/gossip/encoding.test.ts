import {expect} from "chai";
import crypto from "crypto";
import {RPC} from "@chainsafe/libp2p-gossipsub/message";
import {fastMsgIdFn} from "../../../../src/network/gossip/encoding.js";

describe("fastMsgIdFn", function () {
  this.timeout(0);

  const testCases = [1e4, 1e5];
  for (const size of testCases) {
    it("should return consistent value " + size, async () => {
      const entries = new Map<number, number>();

      for (let i = 0; i < size; i++) {
        const data = crypto.randomBytes(32) as Uint8Array;
        const message = {data} as RPC.IMessage;
        const h = fastMsgIdFn(message);
        entries.set(h, i);
      }

      let i = 0;
      for (const [_, v] of entries.entries()) {
        expect(v).to.be.equal(i);
        i++;
      }
    });
  }
});
