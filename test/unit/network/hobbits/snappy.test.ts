import {Goodbye} from "../../../../src/network/hobbits/rpc/messages";

import SnappyJS from 'snappyjs';
import {serialize} from "@chainsafe/ssz";
import {assert, expect} from "chai";

describe("[hobbits] check snappy compression", () => {
  it('should be equal after decompression', function () {
    let body: Goodbye = {
      reason: 3
    };
    let buffer = serialize(body, Goodbye);
    let compressed = SnappyJS.compress(buffer);
    let uncompressed = SnappyJS.uncompress(compressed);

    expect(buffer).to.deep.equal(uncompressed);
  });

  it('shouldn\'t be equal after decompression', function () {
    let body: Goodbye = {
      reason: 3
    };
    let body2: Goodbye = {
      reason: 2
    };
    let buffer = serialize(body, Goodbye);
    let buffer2 = serialize(body2, Goodbye);
    let compressed = SnappyJS.compress(buffer);
    let uncompressed = SnappyJS.uncompress(compressed);

    expect(buffer2).to.not.equal(uncompressed);
  });

});