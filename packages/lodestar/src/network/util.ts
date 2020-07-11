/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @module network
 */

import PeerId from "peer-id";
import {Type} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, MethodResponseType, Methods, RequestId, RESP_TIMEOUT, TTFB_TIMEOUT} from "../constants";
import {source as abortSource} from "abortable-iterator";
import AbortController from "abort-controller";

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

const REQ_PROTOCOL = "/eth2/beacon_chain/req/{method}/{version}/{encoding}";
export function createRpcProtocol(method: string, encoding: string, version = 1): string {
  return REQ_PROTOCOL
    .replace("{method}", method)
    .replace("{encoding}", encoding)
    .replace("{version}", String(version));
}

// peers

/**
 * Return a fresh PeerId instance
 */
export async function createPeerId(): Promise<PeerId> {
  return await PeerId.create({bits: 256, keyType: "secp256k1"});
}

export function getRequestMethodSSZType(
  config: IBeaconConfig, method: Method
): Type<any> {
  return Methods[method].requestSSZType(config);
}

export function getResponseMethodSSZType(
  config: IBeaconConfig, method: Method
): Type<any> {
  return Methods[method].responseSSZType(config);
}

export function isRequestOnly(method: Method): boolean {
  return Methods[method].responseType === MethodResponseType.NoResponse;
}

export function isRequestSingleChunk(method: Method): boolean {
  return Methods[method].responseType === MethodResponseType.SingleResponse;
}

export function eth2ResponseTimer<T>(): (source: AsyncIterable<T>) => AsyncGenerator<T> {
  const controller = new AbortController();
  let responseTimer = setTimeout(() => controller.abort(), TTFB_TIMEOUT);
  const renewTimer = (): void => {
    clearTimeout(responseTimer);
    responseTimer = setTimeout(() => controller.abort(), RESP_TIMEOUT);
  };
  const cancelTimer = (): void => {
    clearTimeout(responseTimer);
  };
  return (source) => {
    return (async function*() {
      for await(const item of abortSource(source, controller.signal, {abortMessage: "response timeout"})) {
        renewTimer();
        yield item;
      }
      cancelTimer();
    })();
  };
}
