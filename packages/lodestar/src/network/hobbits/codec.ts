/**
 * @module network/hobbits
 */

import {HOBBITS_VERSION, Method, ProtocolType, RequestId} from "./constants";
import {DecodedMessage, WireRequestBody, WireRequestHeader} from "./types";
import {toCamelCase, toSnakeCase} from "./util";
import BSON from 'bson';

export function encodeMessage(
  type: ProtocolType, id: RequestId, method: number, encodedBody: Buffer = new Buffer(0)
): Buffer {
  const requestHeader: WireRequestHeader = {
    methodId: method,
    id: id,
  };
  const requestBody: WireRequestBody = {
    body: encodedBody
  };

  console.log(method);

  // bson encoding
  const header = BSON.serialize(toSnakeCase(requestHeader));
  const body = BSON.serialize(requestBody);

  let requestLine = `EWP ${HOBBITS_VERSION} `;
  switch (type) {
    case ProtocolType.RPC:
      requestLine += `${type} ${header.length} ${body.length}\n`;
      break;
    case ProtocolType.GOSSIP:
      break;
    case ProtocolType.PING:
      break;
  }

  const buf = Buffer.from(requestLine, 'utf8');
  return Buffer.concat([buf, header, body]);
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
  const requestBody: WireRequestBody = BSON.deserialize(body, {promoteBuffers: true});

  return {
    version,
    protocol,
    requestHeader,
    requestBody
  };
}