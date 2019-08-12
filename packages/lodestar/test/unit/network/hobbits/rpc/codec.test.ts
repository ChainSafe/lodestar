

import {assert} from "chai";
import BN from "bn.js";
import {AnyContainerType, serialize} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {
  RequestBody,
  ResponseBody,
} from "@chainsafe/eth2.0-types";
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
    it(`should properly encode/decode ${type}`, () => {
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
    it(`should properly encode/decode ${type}`, () => {
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

