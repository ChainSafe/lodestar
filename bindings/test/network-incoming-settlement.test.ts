import {expect, test} from "vitest";
import {applicationConfig, exchange, settleOnly, unreachableConnect} from "./utils/network.js";
import {initializeNativeNetworkRuntime} from "./utils/network-runtime.js";

/** Closes a runtime and settles its pending connect through the host's exchanges until closed. */
async function settleClosedConnect() {
  const runtime = initializeNativeNetworkRuntime(applicationConfig(), () => undefined);
  const connect = runtime.connect(...unreachableConnect()).catch((error: unknown) => error);
  let closed = false;
  void runtime.close().then(() => {
    closed = true;
  });
  for (let i = 0; i < 400 && !closed; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    exchange(runtime, settleOnly);
  }
  return {closed, error: await connect, facade: new WeakRef(runtime)};
}

test("settled errors carry their code and keep no frames that retain the facade", async () => {
  const {closed, error, facade} = await settleClosedConnect();
  expect(closed).toBe(true);
  expect(error).toBeInstanceOf(Error);
  expect(Object.getOwnPropertyDescriptor(error, "code")?.value).toBe("NetworkClosed");
  expect(error).toMatchObject({message: "NetworkClosed", name: "Error", stack: "Error: NetworkClosed"});
  // Dereferencing keeps the target alive for the rest of the job, so each collection runs in a later one.
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    global.gc?.();
    if (!facade.deref()) break;
  }
  expect(facade.deref()).toBeUndefined();
});
