import {Goodbye, WireRequestHeader} from "../../../../src/network/hobbits/rpc/messages";

import SnappyJS from 'snappyjs';
import {deserialize, serialize} from "@chainsafe/ssz";
import {assert, expect} from "chai";
import {id} from "ethers/utils";

import BSON from 'bson';
import {intToBytes} from "../../../../src/util/bytes";

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

  it('should encode using bson encoding', function () {
    let msg = {
      reason: 3
    };

    const body = serialize(msg, Goodbye);

    let doc = {
      method_id: intToBytes(12, 2, "be"),
      body: body
    };

    const Long = BSON;

    const data = BSON.serialize(doc);
    // console.log('data:', data);

    // Deserialize the resulting Buffer
    const doc_2 = BSON.deserialize(data);
    // console.log('doc_2:', doc_2);
    // console.log(doc_2.method_id.buffer);
    // console.log(doc_2.body.buffer);


    const msg2 = deserialize(doc_2.body.buffer, Goodbye);
    // console.log(msg2);
  });
});