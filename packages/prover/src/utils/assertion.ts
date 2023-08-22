import {Lightclient} from "@lodestar/light-client";
import {
  EIP1193Provider,
  EthersProvider,
  RequestProvider,
  SendAsyncProvider,
  SendProvider,
  Web3Provider,
} from "../interfaces.js";

export function assertLightClient(client?: Lightclient): asserts client is Lightclient {
  if (!client) {
    throw new Error("Light client is not initialized yet.");
  }
}

/**
 * Checks if the provider is a web3.js version 4x.
 */
export function isWeb3jsProvider(provider: Web3Provider): provider is EIP1193Provider {
  return (
    "isWeb3Provider" in provider.constructor &&
    (provider.constructor as {isWeb3Provider: (provider: Web3Provider) => boolean}).isWeb3Provider(provider)
  );
}

export function isSendProvider(provider: Web3Provider): provider is SendProvider {
  return (
    !isWeb3jsProvider(provider) &&
    "send" in provider &&
    typeof provider.send === "function" &&
    provider.send.length > 1 &&
    provider.send.constructor.name !== "AsyncFunction"
  );
}

export function isEthersProvider(provider: Web3Provider): provider is EthersProvider {
  return (
    !isWeb3jsProvider(provider) &&
    "send" in provider &&
    typeof provider.send === "function" &&
    provider.send.length > 1 &&
    provider.send.constructor.name === "AsyncFunction"
  );
}

export function isRequestProvider(provider: Web3Provider): provider is RequestProvider {
  return (
    !isWeb3jsProvider(provider) &&
    "request" in provider &&
    typeof provider.request === "function" &&
    provider.request.length > 1
  );
}

export function isSendAsyncProvider(provider: Web3Provider): provider is SendAsyncProvider {
  return (
    "sendAsync" in provider &&
    typeof provider.sendAsync === "function" &&
    provider.sendAsync.constructor.name === "AsyncFunction"
  );
}

export function isEIP1193Provider(provider: Web3Provider): provider is EIP1193Provider {
  return (
    !isWeb3jsProvider(provider) &&
    "request" in provider &&
    typeof provider.request === "function" &&
    provider.request.constructor.name === "AsyncFunction"
  );
}

export function isTruthy<T = unknown>(value: T): value is Exclude<T, undefined | null> {
  return value !== undefined && value !== null && value !== false;
}
