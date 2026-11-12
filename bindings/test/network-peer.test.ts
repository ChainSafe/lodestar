import {type ChildProcess, fork} from "node:child_process";
import {once} from "node:events";
import {afterEach, expect, test, vi} from "vitest";
import {applicationConfig} from "./utils/network.js";
import {startPeer} from "./utils/network-peer.js";

vi.mock("node:child_process", async (original) => {
  const childProcess = await original<typeof import("node:child_process")>();
  return {...childProcess, fork: vi.fn(childProcess.fork)};
});

function lastChild(): ChildProcess {
  const result = vi.mocked(fork).mock.results.at(-1);
  if (result?.type !== "return") throw Error("Peer fixture did not fork a child");
  return result.value;
}

afterEach(async () => {
  const child = lastChild();
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit", {signal: AbortSignal.timeout(5000)});
  child.kill("SIGKILL");
  await exited;
});

function expectExited(child: ChildProcess): void {
  expect(child.connected).toBe(false);
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
}

test("peer fixture keeps closed-runtime diagnostics available until stop reaps the process", async () => {
  const peer = await startPeer(applicationConfig());
  const child = lastChild();
  try {
    await peer.close();
    expect(child.connected).toBe(true);
    expect((await peer.drainLogs()).records.some((record) => record.message.startsWith("owner_stopped "))).toBe(true);
    const stopped = peer.stop();
    expect(peer.stop()).toBe(stopped);
    await stopped;
    expectExited(child);
    await peer.stop();
  } finally {
    await peer.stop();
  }
});

test("peer fixture reaps the process before rejecting failed initialization", async () => {
  const config = applicationConfig();
  config.resources.bridgeBudgetBytes = 0;
  await expect(startPeer(config)).rejects.toMatchObject({code: "InvalidNetworkInteger"});
  expectExited(lastChild());
});
