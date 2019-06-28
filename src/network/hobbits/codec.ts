import {bytes, bytes32} from "../../types";
import {PROTOCOL_VERSION} from "./constants";
import {DecodedMessage} from "./types";

export enum protocolType {
  RPC,
  GOSSIP
}

export function encodeMassage(type: protocolType, message: Buffer): Buffer {
  let requestLine: string = "EWP " + PROTOCOL_VERSION+" ";
  if (type == protocolType.RPC) {
    requestLine += "RPC 0 "+ message.length + "\n";
  } else {
    requestLine += "GOSSIP";
  }

  let buf = Buffer.from(requestLine, 'utf8');
  return Buffer.concat([buf, message]);
}

export function decodeMassage(message: Buffer): DecodedMessage {
  let requestLineBytes: bytes = null;
  for (let i =0; i<message.length; i++){
    // process.stdout.write(String.fromCharCode(message[i]));
    if(String.fromCharCode(message[i]) == "\n"){
      requestLineBytes = message.slice(0, i+1);
      break;
    }
  }
  if (requestLineBytes == null) {
    return null;
  }

  let requestLine = requestLineBytes.toString();

  let segments = requestLine.split(" ");
  let protocol = segments[0];
  let version = parseFloat(segments[1]);
  let command = segments[2];
  let headerLength = parseInt(segments[3]);
  let bodyLength = parseInt(segments[4]);

  // console.log("command: " + command + " headerLength: " + headerLength + " bodyLength: " + bodyLength);

  let payloadStartedAT = requestLineBytes.length + headerLength;
  let header = message.slice(requestLineBytes.length, payloadStartedAT);
  let payload = message.slice(payloadStartedAT, payloadStartedAT+bodyLength+1);

  return {
    protocol,
    version,
    command,
    header,
    payload
  };
}