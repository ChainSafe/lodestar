/**
 * @module network/hobbits
 */

import {bytes} from "../../types";
import {HOBBITS_VERSION, ProtocolType} from "./constants";
import {DecodedMessage} from "./types";


export function encodeMessage(type: ProtocolType, header: Buffer = new Buffer(0), message: Buffer = new Buffer(0)): Buffer {
  let requestLine = `EWP ${HOBBITS_VERSION} `;
  switch (type) {
    case ProtocolType.RPC:
      requestLine += `${type} ${header.length} ${message.length}\n`;
      break;
    case ProtocolType.GOSSIP:
      break;
    case ProtocolType.PING:
      break;
  }

  const buf = Buffer.from(requestLine, 'utf8');
  return Buffer.concat([buf, header, message]);
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

  let payloadStartedAT = requestLineBytes.length + headerLength;
  let header = message.slice(requestLineBytes.length, payloadStartedAT);
  let payload = message.slice(payloadStartedAT, payloadStartedAT+bodyLength+1);

  return {
    version,
    protocol,
    header,
    payload
  };
}