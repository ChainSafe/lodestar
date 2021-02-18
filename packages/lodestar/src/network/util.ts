/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @module network
 */

import PeerId from "peer-id";
import {Method, MethodResponseType, Methods, ReqRespEncoding, RequestId} from "../constants";
import Multiaddr from "multiaddr";
import {networkInterfaces} from "os";
import {ENR} from "@chainsafe/discv5";

// req/resp

export function createResponseEvent(id: RequestId): string {
  return `response ${id}`;
}

/**
 * Render protocol ID
 */
export function createRpcProtocol(method: Method, encoding: ReqRespEncoding, version = 1): string {
  return `/eth2/beacon_chain/req/${method}/${version}/${encoding}`;
}

export function parseProtocolId(protocolId: string): {method: Method; encoding: ReqRespEncoding; version: number} {
  const suffix = protocolId.split("eth2/beacon_chain/req/")[1];
  if (!suffix) throw Error(`Invalid protocolId: ${protocolId}`);

  const [method, version, encoding] = suffix.split("/");
  return {
    method: method as Method,
    version: parseInt(version),
    encoding: encoding as ReqRespEncoding,
  };
}

// peers

/**
 * Return a fresh PeerId instance
 */
export async function createPeerId(): Promise<PeerId> {
  return await PeerId.create({bits: 256, keyType: "secp256k1"});
}

export function isRequestSingleChunk(method: Method): boolean {
  return Methods[method].responseType === MethodResponseType.SingleResponse;
}

export function getStatusProtocols(): string[] {
  return [createRpcProtocol(Method.Status, ReqRespEncoding.SSZ_SNAPPY)];
}

export function getSyncProtocols(): string[] {
  return [createRpcProtocol(Method.BeaconBlocksByRange, ReqRespEncoding.SSZ_SNAPPY)];
}

export function getUnknownRootProtocols(): string[] {
  return [createRpcProtocol(Method.BeaconBlocksByRoot, ReqRespEncoding.SSZ_SNAPPY)];
}

/**
 * Check if multiaddr belongs to the local network interfaces.
 */
export function isLocalMultiAddr(multiaddr: Multiaddr | undefined): boolean {
  if (!multiaddr) return false;

  const protoNames = multiaddr.protoNames();
  if (protoNames.length !== 2 && protoNames[1] !== "udp") {
    throw new Error("Invalid udp multiaddr");
  }

  const interfaces = networkInterfaces();
  const tuples = multiaddr.tuples();
  const isIPv4: boolean = tuples[0][0] === 4;
  const family = isIPv4 ? "IPv4" : "IPv6";
  const ip = tuples[0][1];

  const ipStr = isIPv4
    ? Array.from(ip).join(".")
    : Array.from(Uint16Array.from(ip))
        .map((n) => n.toString(16))
        .join(":");

  const localIpStrs = Object.values(interfaces)
    .reduce((finalArr, val) => finalArr.concat(val), [])
    .filter((networkInterface) => networkInterface.family === family)
    .map((networkInterface) => networkInterface.address);

  return localIpStrs.includes(ipStr);
}

export function clearMultiaddrUDP(enr: ENR): void {
  // enr.multiaddrUDP = undefined in new version
  enr.delete("ip");
  enr.delete("udp");
  enr.delete("ip6");
  enr.delete("udp6");
}
