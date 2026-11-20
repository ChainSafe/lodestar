import {type ChildProcess, fork} from "node:child_process";
import {once} from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Worker} from "node:worker_threads";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {BuilderSigningGuard} from "../../../src/services/builderSigningGuard.js";

describe("BuilderSigningGuard", () => {
  let directory: string;
  const guards: BuilderSigningGuard[] = [];
  const children: ChildProcess[] = [];

  async function acquire(target = directory): Promise<BuilderSigningGuard> {
    const guard = await BuilderSigningGuard.acquire(target);
    guards.push(guard);
    return guard;
  }

  async function probeFromProcess(): Promise<"ready" | "blocked"> {
    const child = fork(fileURLToPath(new URL("../fixtures/signingGuardOwner.ts", import.meta.url)), [directory], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    children.push(child);
    return new Promise((resolve, reject) => {
      child.once("message", () => resolve("ready"));
      child.once("error", reject);
      child.once("exit", (code) => (code === 1 ? resolve("blocked") : reject(Error(`unexpected exit ${code}`))));
    });
  }

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "builder-signing-guard-"));
  });

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
    }
    await Promise.all(guards.splice(0).map((guard) => guard.close()));
    fs.rmSync(directory, {recursive: true, force: true});
  });

  it("fences a second owner and a symlink alias without modifying retained files", async () => {
    const journal = path.join(directory, "journal");
    const alias = path.join(directory, "alias");
    fs.mkdirSync(journal);
    fs.symlinkSync(journal, alias, "dir");
    const retained = Buffer.from("previously acknowledged payload bytes");
    fs.writeFileSync(path.join(journal, "retained.json"), retained);
    const guard = await acquire(journal);
    await expect(acquire(journal)).rejects.toThrow("BUILDER_SIGNER_OWNERSHIP_UNAVAILABLE");
    await expect(acquire(alias)).rejects.toThrow("BUILDER_SIGNER_OWNERSHIP_UNAVAILABLE");
    expect(fs.readFileSync(path.join(journal, "retained.json"))).toEqual(retained);
    await guard.close();
    const next = await acquire(alias);
    expect(() => next.assertActive()).not.toThrow();
    expect(fs.readFileSync(path.join(journal, "retained.json"))).toEqual(retained);
  });

  it("revokes bid and envelope signing before releasing ownership", async () => {
    const guard = await acquire();
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
    const signer = new BuilderSigner(
      createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32)),
      {secretKey, publicKey: secretKey.toPublicKey()},
      () => guard.assertActive()
    );
    const bid = ssz.gloas.ExecutionPayloadBid.defaultValue();
    const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
    expect(signer.signExecutionPayloadBid(bid).signature.length).toBe(96);
    expect(signer.signExecutionPayloadEnvelope(envelope).signature.length).toBe(96);
    guard.revoke();
    expect(() => signer.signExecutionPayloadBid(bid)).toThrow("BUILDER_SIGNER_OWNERSHIP_RELEASED");
    expect(() => signer.signExecutionPayloadEnvelope(envelope)).toThrow("BUILDER_SIGNER_OWNERSHIP_RELEASED");
    await expect(acquire()).rejects.toThrow("BUILDER_SIGNER_OWNERSHIP_UNAVAILABLE");
    await guard.close();
    await acquire();
  });

  it("keeps the kernel lock after another same-process acquisition is rejected", async () => {
    const guard = await acquire();
    await expect(acquire()).rejects.toThrow("BUILDER_SIGNER_OWNERSHIP_UNAVAILABLE");
    expect(() => guard.assertActive()).not.toThrow();
    expect(await probeFromProcess()).toBe("blocked");
  });

  it("rejects acquisition in another worker before it can affect the process lock", async () => {
    const guard = await acquire();
    const worker = new Worker(
      `const {parentPort, workerData} = require("node:worker_threads");
       (async () => {
         const {register} = await import("tsx/esm/api");
         register();
         const {BuilderSigningGuard} = await import(workerData.module);
         const guard = await BuilderSigningGuard.acquire(workerData.directory);
         await guard.close();
         return "acquired";
       })().then(value => parentPort.postMessage(value), error => parentPort.postMessage(error.message));`,
      {
        eval: true,
        workerData: {module: new URL("../../../src/services/builderSigningGuard.ts", import.meta.url).href, directory},
      }
    );
    try {
      const [message] = await once(worker, "message");
      expect(message).toBe("BUILDER_SIGNER_WORKER_THREAD");
      expect(() => guard.assertActive()).not.toThrow();
      expect(await probeFromProcess()).toBe("blocked");
    } finally {
      await worker.terminate();
    }
  });

  it.skipIf(process.platform !== "linux")("keeps a suspended process fenced and releases after SIGKILL", async () => {
    const child = fork(fileURLToPath(new URL("../fixtures/signingGuardOwner.ts", import.meta.url)), [directory], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    await new Promise<void>((resolve, reject) => {
      child.once("message", (message) => (message === "ready" ? resolve() : reject(Error(String(message)))));
      child.once("error", reject);
      child.once("exit", (code) => reject(Error(`owner exited ${code}: ${stderr}`)));
    });
    await expect(acquire()).rejects.toThrow("BUILDER_SIGNER_OWNERSHIP_UNAVAILABLE");
    expect(child.kill("SIGSTOP")).toBe(true);
    await vi.waitFor(() => {
      const state = fs.readFileSync(`/proc/${child.pid}/stat`, "utf8").split(") ")[1][0];
      expect(state).toBe("T");
    });
    await expect(acquire()).rejects.toThrow("BUILDER_SIGNER_OWNERSHIP_UNAVAILABLE");
    const exited = once(child, "exit");
    expect(child.kill("SIGKILL")).toBe(true);
    await exited;
    await acquire();
  });
});
