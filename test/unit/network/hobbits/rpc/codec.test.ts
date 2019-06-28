import {assert} from "chai";
import BN from "bn.js";
import {AnyContainerType, serialize} from "@chainsafe/ssz";

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
} from "../../../../../src/network/hobbits/rpc/messages";
import {
  Method,
} from "../../../../../src/network/hobbits/constants";

import {
  encodeRequest,
  decodeRequestBody,
} from "../../../../../src/network/hobbits/rpc/codec";

describe("[hobbits] rpc request", () => {
  const testCases: {
    msg: RequestBody;
    method: Method;
    type: AnyContainerType;
  }[] = [
    {
      msg: {
        networkId: 0,
        chainId: 0,
        latestFinalizedRoot: Buffer.alloc(32),
        latestFinalizedEpoch: 0,
        bestRoot: Buffer.alloc(32),
        bestSlot: 0,
      },
      method: Method.Hello,
      type: Hello,
    },
    {
      msg: {
        reason: 0,
      },
      method: Method.Goodbye,
      type: Goodbye,
    },
    {
      msg: {
        userAgent: Buffer.alloc(10),
        timestamp: 0,
      },
      method: Method.GetStatus,
      type: GetStatus,
    },
    {
      msg: {
        startRoot: Buffer.alloc(32),
        startSlot: 0,
        max: 0,
        skip: 0,
        direction: 0
      },
      method: Method.GetBlockHeaders,
      type: GetBlockHeaders,
    },
    {
      msg: {
        headers: [],
      },
      method: Method.BlockHeaders,
      type: BlockHeaders,
    },
    {
      msg: {
        startRoot: Buffer.alloc(32),
        startSlot: 0,
        max: 0,
        skip: 0,
        direction: 0
      },
      method: Method.GetBlockBodies,
      type: GetBlockBodies,
    },
    {
      msg: {
        bodies: [],
      },
      method: Method.BlockBodies,
      type: BlockBodies,
    },
  ];
  for (const {msg, method, type} of testCases) {
    it(`should properly encode/decode ${type.name}`, () => {
      const id = 0;
      // encode
      const body = serialize(msg, type);
      const expectedEncoded = serialize({
        id: id,
        methodId: method,
        body: body,
      }, WireRequest);
      const actualEncoded = encodeRequest(id, method, msg);
      assert.deepEqual(actualEncoded, expectedEncoded);
      // decode
      const decodedBody = decodeRequestBody(method, body);
      assert.deepEqual(decodedBody, msg);
    });
  }
});

