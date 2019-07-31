import {assert} from "chai";
import BN from "bn.js";
import {AnyContainerType, serialize} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
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
} from "@chainsafe/eth2.0-types";

import {
  Method,
} from "../../../src/constants";
import {
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
      type: config.types.Hello,
    },
    {
      msg: {
        reason: new BN(0),
      },
      method: Method.Goodbye,
      type: config.types.Goodbye,
    },
    {
      msg: {
        sha: Buffer.alloc(32),
        userAgent: Buffer.alloc(10),
        timestamp: 0,
      },
      method: Method.Status,
      type: config.types.Status,
    },
    {
      msg: {
        startSlot: 0,
        count: 0,
      },
      method: Method.BeaconBlockRoots,
      type: config.types.BeaconBlockRootsRequest,
    },
    {
      msg: {
        startRoot: Buffer.alloc(32),
        startSlot: 0,
        maxHeaders: 0,
        skipSlots: 0,
      },
      method: Method.BeaconBlockHeaders,
      type: config.types.BeaconBlockHeadersRequest,
    },
    {
      msg: {
        blockRoots: [],
      },
      method: Method.BeaconBlockBodies,
      type: config.types.BeaconBlockBodiesRequest,
    },
    {
      msg: {
        hashes: [],
      },
      method: Method.BeaconStates,
      type: config.types.BeaconStatesRequest,
    },
  ];
  for (const {msg, method, type} of testCases) {
    it(`should properly encode/decode ${type}`, () => {
      const idHex = "FFFFFFFFFFFFFFFF";
      // encode
      const body = serialize(msg, type);
      const expectedEncoded = serialize({
        id: Buffer.from(idHex, "hex"),
        method,
        body,
      }, config.types.WireRequest);
      const actualEncoded = encodeRequest(config, idHex, method, msg);
      assert.deepEqual(actualEncoded, expectedEncoded);
      // decode
      const decodedBody = decodeRequestBody(config, method, body);
      assert.deepEqual(decodedBody.toString(), msg.toString());
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
      type: config.types.Hello,
    },
    {
      msg: {
        reason: new BN(0),
      },
      method: Method.Goodbye,
      type: config.types.Goodbye,
    },
    {
      msg: {
        sha: Buffer.alloc(32),
        userAgent: Buffer.alloc(10),
        timestamp: 0,
      },
      method: Method.Status,
      type: config.types.Status,
    },
    {
      msg: {
        roots: [],
      },
      method: Method.BeaconBlockRoots,
      type: config.types.BeaconBlockRootsResponse,
    },
    {
      msg: {
        headers: []
      },
      method: Method.BeaconBlockHeaders,
      type: config.types.BeaconBlockHeadersResponse,
    },
    {
      msg: {
        blockBodies: [],
      },
      method: Method.BeaconBlockBodies,
      type: config.types.BeaconBlockBodiesResponse,
    },
    {
      msg: {
        states: [],
      },
      method: Method.BeaconStates,
      type: config.types.BeaconStatesResponse,
    },
  ];
  for (const {msg, method, type} of testCases) {
    it(`should properly encode/decode ${type}`, () => {
      const idHex = "FFFFFFFFFFFFFFFF";
      const responseCode = 0;
      // encode
      const result = serialize(msg, type);
      const expectedEncoded = serialize({
        id: Buffer.from(idHex, "hex"),
        responseCode,
        result,
      }, config.types.WireResponse);
      const actualEncoded = encodeResponse(config, idHex, method, responseCode, msg);
      assert.deepEqual(actualEncoded, expectedEncoded);
      // decode
      const decodedBody = decodeResponseBody(config, method, result);
      assert.deepEqual(decodedBody.toString(), msg.toString());
    });
  }
});
