import {Lightclient} from "@lodestar/light-client";
import {SendAsyncProvider, SendProvider, Web3Provider} from "../interfaces.js";

export function assertLightClient(client?: Lightclient): asserts client is Lightclient {
  if (!client) {
    throw new Error("Light client is not initialized yet.");
  }
}

export function isSendProvider(provider: Web3Provider): provider is SendProvider {
  return "send" in provider && typeof provider.send === "function" && provider.send.length > 1;
}

export function isSendAsyncProvider(provider: Web3Provider): provider is SendAsyncProvider {
  return "sendAsync" in provider && typeof provider.sendAsync === "function";
}
