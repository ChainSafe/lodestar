import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

// import SnappyJS from 'snappyjs';
import {deserialize, serialize} from "@chainsafe/ssz";
import {assert, expect} from "chai";
import {id} from "ethers/utils";

import BSON from 'bson';
import {intToBytes} from "../../../../src/util/bytes";
import BN from "bn.js";

/*
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
*/

describe("[hobbits] check bson encoding-decoding", () => {
  it('should encode using bson encoding', function () {
    let msg = {
      reason: new  BN(3)
    };

    const body = serialize(msg, config.types.Goodbye);

    let doc = {
      methodId: intToBytes(12, 2, "be"),
      body: body
    };

    const data = BSON.serialize(doc);
    // console.log('data:', data);

    // Deserialize the resulting Buffer
    const doc2 = BSON.deserialize(data, {promoteBuffers: true});
    // console.log('doc_2:', doc2);

    // const msg2 = deserialize(doc2.body, config.types.Goodbye);
    // console.log(msg2);
    assert.deepEqual(doc2, doc);

  });

  it('should encode using bson encoding #2', function () {
    let msg = {
      reason: new  BN(3)
    };

    const body = serialize(msg, config.types.Goodbye);

    let doc = {
      methodId: 12,
      // body: body
    };

    const data = BSON.serialize(doc);
    // console.log('data:', data);

    // Deserialize the resulting Buffer
    const doc2 = BSON.deserialize(data);
    assert.deepEqual(doc2, doc);

  });
});