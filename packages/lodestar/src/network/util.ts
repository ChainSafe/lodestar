/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @module network
 */

import PeerId from "peer-id";
import {AbortController, AbortSignal} from "abort-controller";
import {
  Method,
  MethodResponseType,
  Methods,
  ReqRespEncoding,
  RequestId,
  RESP_TIMEOUT,
  TTFB_TIMEOUT,
} from "../constants";
import {source as abortSource} from "abortable-iterator";
import Multiaddr from "multiaddr";
import {networkInterfaces} from "os";
import {ENR} from "@chainsafe/discv5";
import {RESPONSE_TIMEOUT_ERR} from "./error";
import {anySignal} from "any-signal";

// req/resp

function randomNibble(): string {
  return Math.floor(Math.random() * 16).toString(16);
}

export function randomRequestId(): RequestId {
  return Array.from({length: 16}, () => randomNibble()).join("");
}

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

export function isRequestOnly(method: Method): boolean {
  return Methods[method].responseType === MethodResponseType.NoResponse;
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

export function eth2ResponseTimer<T>(
  streamAbortController: AbortController
): (source: AsyncIterable<T>) => AsyncGenerator<T> {
  const controller = new AbortController();

  let responseTimer = setTimeout(() => {
    controller.abort();
  }, TTFB_TIMEOUT);

  controller.signal.addEventListener("abort", () => streamAbortController.abort());

  const renewTimer = (): void => {
    clearTimeout(responseTimer);
    responseTimer = setTimeout(() => controller.abort(), RESP_TIMEOUT);
  };

  const cancelTimer = (): void => {
    clearTimeout(responseTimer);
  };

  return async function* (source) {
    for await (const item of abortSource(source, controller.signal, {abortMessage: RESPONSE_TIMEOUT_ERR})) {
      renewTimer();
      yield item;
    }
    cancelTimer();
  };
}

export async function dialProtocol(
  libp2p: LibP2p,
  peerId: PeerId,
  protocol: string,
  timeout: number,
  signal?: AbortSignal
): ReturnType<LibP2p["dialProtocol"]> {
  const abortController = new AbortController();

  const timer = setTimeout(() => {
    abortController.abort();
  }, timeout);

  const signals = [abortController.signal];
  if (signal) {
    signals.push(signal);
  }

  const abortSignal = anySignal(signals);

  try {
    const conn = await libp2p.dialProtocol(peerId, protocol, {signal: abortSignal});
    if (!conn) {
      throw new Error("timeout");
    }
    return conn;
  } catch (e) {
    const err = new Error(e.code || e.message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
