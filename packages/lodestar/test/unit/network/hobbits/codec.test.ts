import {assert} from "chai";
import BN from "bn.js";
import {deserialize, hashTreeRoot, serialize} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import {
  GossipMethod, GossipTopic,
  Method, ProtocolType,
} from "../../../../src/network/hobbits/constants";

import {
  encodeRequestBody,
  decodeRequestBody,
} from "../../../../src/network/hobbits/rpc/codec";

import {
  encodeMessage,
  decodeMessage, generateRPCHeader, generateGossipHeader,
} from "../../../../src/network/hobbits/codec";
import {DecodedMessage, RPCBody} from "../../../../src/network/hobbits/types";
import {keccak256} from "ethers/utils";
import {BeaconBlock} from "@chainsafe/eth2.0-types";
import {generateEmptyBlock} from "../../../utils/block";

describe("[hobbits] protocol messages", () => {
  it(`rpc - should properly encode/decode`, () => {
    const msg = {
      reason: new BN(3)
    };
    const id = 0;
    const method = Method.Goodbye;
    // encode
    const body = serialize(msg, config.types.Goodbye);
    const actualEncoded = encodeRequestBody(config, method, msg);
    let requestHeader = generateRPCHeader(id, method);
    const encodedMessage = encodeMessage(ProtocolType.RPC, requestHeader, actualEncoded);

    // decode
    const decodedMessage: DecodedMessage = decodeMessage(encodedMessage);
    // console.log(decodedMessage);
    requestHeader = decodedMessage.requestHeader.rpcHeader;
    const requestBody = decodedMessage.requestBody;
    const decodedBody = decodeRequestBody(config, requestHeader.methodId, requestBody);

    // compare
    assert.deepEqual(actualEncoded, body);
    assert.deepEqual(requestBody, actualEncoded);
    assert.deepEqual(decodedBody.toString(), msg.toString());
  });

  it(`gossip - should properly encode/decode`, () => {
    // encode
    const block: BeaconBlock = generateEmptyBlock();
    const encodedBody = serialize(block, config.types.BeaconBlock);
    const messageHash = Buffer.from(keccak256(encodedBody), "hex");
    const hash = hashTreeRoot(block, config.types.BeaconBlock);
    const requestHeader = generateGossipHeader(GossipMethod.GOSSIP, GossipTopic.Block, messageHash, hash);
    const encodedMessage = encodeMessage(ProtocolType.GOSSIP, requestHeader, encodedBody);

    // decode

    const decodedMessage: DecodedMessage = decodeMessage(encodedMessage);
    // console.log(decodedMessage);
    const body = decodedMessage.requestBody;
    const blockReceived = deserialize(body, config.types.BeaconBlock);

    // compare
    assert.deepEqual(blockReceived, block);
  });

  it(`ping - should properly encode/decode`, () => {
    // encode
    const actualBody = Buffer.alloc(32);
    const encodedMessage = encodeMessage(ProtocolType.PING, "ping", actualBody);

    // decode
    const decodedMessage: DecodedMessage = decodeMessage(encodedMessage);
    // console.log(decodedMessage);
    const requestHeader = decodedMessage.requestHeader.pingHeader;
    const requestBody = decodedMessage.requestBody;

    // compare
    assert.deepEqual(requestBody, actualBody);
    assert.equal(requestHeader, "ping");
  });

});

