import {assert} from "chai";
import BN from "bn.js";
import {AnyContainerType, serialize} from "@chainsafe/ssz";

import {
  Hello,
  Goodbye,
  Status,
  BeaconBlockRootsRequest,
  BeaconBlockHeadersRequest,
  BeaconBlockBodiesRequest,
  BeaconStatesRequest,
  BeaconBlockRootsResponse,
  BeaconBlockHeadersResponse,
  BeaconBlockBodiesResponse,
  BeaconStatesResponse,
  WireRequest,
  WireResponse,
  RequestBody,
  ResponseBody,
} from "../../../src/types";

import {
  Method,
  encodeRequest,
  encodeResponse,
  decodeRequestBody,
  decodeResponseBody,
} from "../../../src/network/codec";

describe("[network] rpc request", () => {
  const testCases: {
    msg: RequestBody;
    method: Method;
    type: AnyContainerType;
  }[] = [
    {
      msg: {
        networkId: new BN(0),
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
        reason: new BN(0),
      },
      method: Method.Goodbye,
      type: Goodbye,
    },
    {
      msg: {
        sha: Buffer.alloc(32),
        userAgent: Buffer.alloc(10),
        timestamp: 0,
      },
      method: Method.Status,
      type: Status,
    },
    {
      msg: {
        startSlot: 0,
        count: 0,
      },
      method: Method.BeaconBlockRoots,
      type: BeaconBlockRootsRequest,
    },
    {
      msg: {
        startRoot: Buffer.alloc(32),
        startSlot: 0,
        maxHeaders: 0,
        skipSlots: 0,
      },
      method: Method.BeaconBlockHeaders,
      type: BeaconBlockHeadersRequest,
    },
    {
      msg: {
        blockRoots: [],
      },
      method: Method.BeaconBlockBodies,
      type: BeaconBlockBodiesRequest,
    },
    {
      msg: {
        hashes: [],
      },
      method: Method.BeaconStates,
      type: BeaconStatesRequest,
    },
  ];
  for (const {msg, method, type} of testCases) {
    it(`should properly encode/decode ${type.name}`, () => {
      const idHex = "FFFFFFFFFFFFFFFF";
      // encode
      const body = serialize(msg, type);
      const expectedEncoded = serialize({
        id: Buffer.from(idHex, "hex"),
        method,
        body,
      }, WireRequest);
      const actualEncoded = encodeRequest(idHex, method, msg);
      assert.deepEqual(actualEncoded, expectedEncoded);
      // decode
      const decodedBody = decodeRequestBody(method, body);
      assert.deepEqual(decodedBody, msg);
    });
  }
});

describe("[p2p] rpc response", () => {
  const testCases: {
    msg: ResponseBody;
    method: Method;
    type: AnyContainerType;
  }[] = [
    {
      msg: {
        networkId: new BN(0),
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
        reason: new BN(0),
      },
      method: Method.Goodbye,
      type: Goodbye,
    },
    {
      msg: {
        sha: Buffer.alloc(32),
        userAgent: Buffer.alloc(10),
        timestamp: 0,
      },
      method: Method.Status,
      type: Status,
    },
    {
      msg: {
        blockRoot: Buffer.alloc(32),
        slot: 0,
        roots: [],
      },
      method: Method.BeaconBlockRoots,
      type: BeaconBlockRootsResponse,
    },
    {
      msg: {
        headers: []
      },
      method: Method.BeaconBlockHeaders,
      type: BeaconBlockHeadersResponse,
    },
    {
      msg: {
        blockBodies: [],
      },
      method: Method.BeaconBlockBodies,
      type: BeaconBlockBodiesResponse,
    },
    {
      msg: {
        states: [],
      },
      method: Method.BeaconStates,
      type: BeaconStatesResponse,
    },
  ];
  for (const {msg, method, type} of testCases) {
    it(`should properly encode/decode ${type.name}`, () => {
      const idHex = "FFFFFFFFFFFFFFFF";
      const responseCode = 0;
      // encode
      const result = serialize(msg, type);
      const expectedEncoded = serialize({
        id: Buffer.from(idHex, "hex"),
        responseCode,
        result,
      }, WireResponse);
      const actualEncoded = encodeResponse(idHex, method, responseCode, msg);
      assert.deepEqual(actualEncoded, expectedEncoded);
      // decode
      const decodedBody = decodeResponseBody(method, result);
      assert.deepEqual(decodedBody, msg);
    });
  }
});
