import {assert} from "chai";
import BN from "bn.js";
import {AnyContainerType, deserialize, serialize} from "@chainsafe/ssz";

import {
  Hello,
  Goodbye,
  GetStatus,
  GetBlockHeaders,
  BlockHeaders,
  GetBlockBodies,
  BlockBodies,
  WireRequest,
  RequestBody,
} from "../../../../src/network/hobbits/rpc/messages";
import {
  Method, ProtocolType,
} from "../../../../src/network/hobbits/constants";

import {
  encodeRequest,
  decodeRequestBody,
} from "../../../../src/network/hobbits/rpc/codec";

import {
  encodeMessage,
  decodeMessage,
} from "../../../../src/network/hobbits/codec";
import {DecodedMessage} from "../../../../src/network/hobbits/types";

describe("[hobbits] rpc protocol message", () => {
  it(`should properly encode/decode`, () => {
    let msg = {
      reason: 3
    };
    const id = 0;
    let method = Method.Goodbye;
    // encode
    const body = serialize(msg, Goodbye);
    const expectedEncoded = serialize({
      id: id,
      methodId: method,
      body: body,
    }, WireRequest);
    const actualEncoded = encodeRequest(id, method, msg);
    assert.deepEqual(actualEncoded, expectedEncoded);

    const encodedMessage = encodeMessage(ProtocolType.RPC, actualEncoded);
    const decodedMessage: DecodedMessage = decodeMessage(encodedMessage);
    console.log(decodedMessage);

    const decodedWireRequest: WireRequest = deserialize(decodedMessage.payload, WireRequest);
    // console.log(decodedWireRequest);

    const decodedRequestBody = decodeRequestBody(decodedWireRequest.methodId,
      decodedWireRequest.body);
    // console.log(decodedRequestBody);

    assert.deepEqual(actualEncoded, decodedMessage.payload);
    assert.deepEqual(msg, decodedRequestBody);

  });
});

