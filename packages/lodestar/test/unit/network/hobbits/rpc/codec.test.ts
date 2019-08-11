
/*import {
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
} from "../../../../../src/network/hobbits/rpc/codec";*/
/*

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
*/



import {assert} from "chai";
import BN from "bn.js";
import {AnyContainerType, serialize} from "@chainsafe/ssz";

import {config} from "../../../../../src/config/presets/mainnet";
import {
  RequestBody,
  ResponseBody,
} from "../../../../../src/types";
import {
  Method,
} from "../../../../../src/network/hobbits/constants";

import {
  encodeRequestBody,
  decodeRequestBody,
} from "../../../../../src/network/hobbits/rpc/codec";
import {generateEmptyAttestation} from "../../../../utils/attestation";

describe("[hobbits] rpc request", () => {
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
      type: config.types.HobbitsHello,
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
        userAgent: Buffer.alloc(10),
        timestamp: 0,
      },
      method: Method.GetStatus,
      type: config.types.HobbitsStatus,
    },
    {
      msg: {
        startRoot: Buffer.alloc(32),
        startSlot: 0,
        max: new BN(0),
        skip: new BN(0),
        direction: 0
      },
      method: Method.GetBlockHeaders,
      type: config.types.HobbitsGetBlockHeaders,
    },
    {
      msg: {
        startRoot: Buffer.alloc(32),
        startSlot: 0,
        max: new BN(0),
        skip: new BN(0),
        direction: 0
      },
      method: Method.GetBlockBodies,
      type: config.types.HobbitsGetBlockBodies,
    },
    {
      msg: {
        hash: Buffer.alloc(32)
      },
      method: Method.GetAttestation,
      type: config.types.HobbitsGetAttestation,
    },
    {
      msg: {
        hashes: [],
      },
      method: Method.GetBeaconStates,
      type: config.types.BeaconStatesRequest,
    },
  ];
  for (const {msg, method, type} of testCases) {
    it(`should properly encode/decode ${type.name}`, () => {
      // encode
      const body = serialize(msg, type);
      const actualEncoded = encodeRequestBody(config, method, msg);
      assert.deepEqual(actualEncoded, body);
      // decode
      const decodedBody = decodeRequestBody(config, method, actualEncoded);
      assert.deepEqual(decodedBody.toString(), msg.toString());
    });
  }
});

describe("[hobbits] rpc response", () => {
  const testCases: {
    msg: ResponseBody;
    method: Method;
    type: AnyContainerType;
  }[] = [
    {
      msg: {
        headers: []
      },
      method: Method.BlockHeaders,
      type: config.types.BeaconBlockHeadersResponse,
    },
    {
      msg: {
        bodies: [],
      },
      method: Method.BlockBodies,
      type: config.types.HobbitsBlockBodies,
    },
    {
      msg: {
        attestation: generateEmptyAttestation()
      },
      method: Method.AttestationResponse,
      type: config.types.HobbitsAttestation,
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
    it(`should properly encode/decode ${type.name}`, () => {
      // encode
      const body = serialize(msg, type);
      const actualEncoded = encodeRequestBody(config, method, msg);
      assert.deepEqual(actualEncoded, body);
      // decode
      const decodedBody = decodeRequestBody(config, method, actualEncoded);
      assert.deepEqual(decodedBody.toString(), msg.toString());
    });
  }
});

