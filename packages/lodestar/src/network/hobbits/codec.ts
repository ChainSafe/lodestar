/**
 * @module network/hobbits
 */

import {GossipTopic, HOBBITS_VERSION, Method, ProtocolType, RequestId} from "./constants";
import {DecodedMessage, GossipHeader, RPCBody, RPCHeader, WireRequestBody, WireRequestHeader} from "./types";
import {toCamelCase, toSnakeCase} from "./util";
import BSON from 'bson';
import {bytes32} from "../../types";
import {intDiv} from "../../util/math";
import BN from "bn.js";

export function encodeMessage(
  type: ProtocolType, requestHeader: WireRequestHeader, encodedBody: Buffer = new Buffer(0)
): Buffer {
  // console.log(method);

  let requestLine = `EWP ${HOBBITS_VERSION} `;
  let requestBody, header, body;

  switch (type) {
    case ProtocolType.RPC:
      requestBody = {
        body: encodedBody
      };
      // bson encoding
      body = BSON.serialize(requestBody);
      break;

    case ProtocolType.GOSSIP:
      body = encodedBody;
      break;

    case ProtocolType.PING:
      break;
  }

  // bson encoding
  header = BSON.serialize(toSnakeCase(requestHeader));

  requestLine += `${type} ${header.length} ${body.length}\n`;
  const buf = Buffer.from(requestLine, 'utf8');
  return Buffer.concat([buf, header, body]);
}

export function generateRPCHeader(id: RequestId, method: number): WireRequestHeader {
  return {
    methodId: method,
    id: id,
  };
}

export function generateGossipHeader(
  method: number, topic: GossipTopic, messageHash: bytes32, hash: bytes32
): WireRequestHeader {
  // const attestationRoot = hashTreeRoot(attestation, this.config.types.Attestation);
  return {
    methodId: method,
    topic,
    timestamp: new BN(intDiv(Date.now(), 1000)),
    messageHash,
    hash,
  };
}

export function decodeMessage(message: Buffer): DecodedMessage {
  const requestLineBytes = message.slice(0, message.indexOf(Buffer.from("\n")) + 1);
  if (requestLineBytes == null) {
    return null;
  }

  let requestLine = requestLineBytes.toString();

  const segments = requestLine.split(" ");
  const version = parseFloat(segments[1]);
  const protocol = parseInt(segments[2]);
  const headerLength = parseInt(segments[3]);
  const bodyLength = parseInt(segments[4]);

  // console.log("protocol: " + protocol + " headerLength: " + headerLength + " bodyLength: " + bodyLength);

  const payloadStartedAT = requestLineBytes.length + headerLength;
  const header = message.slice(requestLineBytes.length, payloadStartedAT);
  const body = message.slice(payloadStartedAT, payloadStartedAT+bodyLength+1);

  // bson decoding
  const requestHeader: WireRequestHeader = toCamelCase(BSON.deserialize(header, {promoteBuffers: true}));

  let requestBody;
  switch (protocol) {
    case ProtocolType.RPC:
      // bson decoding
      const decodedBody: RPCBody = BSON.deserialize(body, {promoteBuffers: true});
      requestBody = decodedBody.body;
      break;

    case ProtocolType.GOSSIP:
      requestBody = body;
      break;

    case ProtocolType.PING:
      break;
  }

  return {
    version,
    protocol,
    requestHeader,
    requestBody
  };
}