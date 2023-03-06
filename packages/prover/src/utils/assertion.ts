import {Lightclient} from "@lodestar/light-client";
import {EIP1193Provider, RequestProvider, SendAsyncProvider, SendProvider, Web3Provider} from "../interfaces.js";

export function assertLightClient(client?: Lightclient): asserts client is Lightclient {
  if (!client) {
    throw new Error("Light client is not initialized yet.");
  }
}

export function isSendProvider(provider: Web3Provider): provider is SendProvider {
  return "send" in provider && typeof provider.send === "function" && provider.send.length > 1;
}

export function isRequestProvider(provider: Web3Provider): provider is RequestProvider {
  return "request" in provider && typeof provider.request === "function" && provider.request.length > 1;
}

export function isSendAsyncProvider(provider: Web3Provider): provider is SendAsyncProvider {
  return (
    "sendAsync" in provider &&
    typeof provider.sendAsync === "function" &&
    provider.sendAsync.constructor.name === "AsyncFunction"
  );
}

export function isEIP1193Provider(provider: EIP1193Provider): provider is EIP1193Provider {
  return (
    "request" in provider &&
    typeof provider.request === "function" &&
    provider.request.constructor.name === "AsyncFunction"
  );
}
