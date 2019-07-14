/**
 * @module network/hobbits
 */

import {bytes, bytes32} from "../../types";
import {HOBBITS_VERSION, ProtocolType} from "./constants";
import {DecodedMessage} from "./types";


export function encodeMessage(type: ProtocolType, message: Buffer): Buffer {
  let requestLine = `EWP ${HOBBITS_VERSION} `;
  switch (type) {
    case ProtocolType.RPC:
      requestLine += `${type} 0 ${message.length}\n`;
      break;
    case ProtocolType.GOSSIP:
      requestLine += `${type}`;
      break;
    case ProtocolType.PING:
      requestLine += `${type}`;
      break;
  }

  const buf = Buffer.from(requestLine, 'utf8');
  return Buffer.concat([buf, message]);
}

export function decodeMessage(message: Buffer): DecodedMessage {
  let requestLineBytes: bytes = null;
  for (let i =0; i<message.length; i++){
    if(String.fromCharCode(message[i]) == "\n"){
      requestLineBytes = message.slice(0, i+1);
      break;
    }
  }
  if (requestLineBytes == null) {
    return null;
  }

  let requestLine = requestLineBytes.toString();

  const segments = requestLine.split(" ");
  const version = parseFloat(segments[1]);
  const protocol = parseInt(segments[2]);
  const headerLength = parseInt(segments[3]);
  const bodyLength = parseInt(segments[4]);

  console.log("protocol: " + protocol + " headerLength: " + headerLength + " bodyLength: " + bodyLength);

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