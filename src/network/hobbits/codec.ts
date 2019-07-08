import {bytes, bytes32} from "../../types";
import {HOBBITS_VERSION, ProtocolType} from "./constants";
import {DecodedMessage} from "./types";


export function encodeMessage(type: ProtocolType, message: Buffer): Buffer {
  let requestLine: string = "EWP " + HOBBITS_VERSION+" ";
  if (type == ProtocolType.RPC) {
    requestLine += type+ " 0 "+ message.length + "\n";
  } else if (type == ProtocolType.GOSSIP) {
    requestLine += "GOSSIP";
  } else if (type == ProtocolType.PING) {
    requestLine += "PING";
  }

  let buf = Buffer.from(requestLine, 'utf8');
  return Buffer.concat([buf, message]);
}

export function decodeMessage(message: Buffer): DecodedMessage {
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
  let version = parseFloat(segments[1]);
  let protocol = segments[2];
  let headerLength = parseInt(segments[3]);
  let bodyLength = parseInt(segments[4]);

  // console.log("command: " + command + " headerLength: " + headerLength + " bodyLength: " + bodyLength);

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