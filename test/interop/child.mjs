import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {access, stat} from "node:fs/promises";
import {relative, resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const lineMax = 65536;
const linesMax = 1024;
const stderrMax = 16 * 1024 * 1024;
const pendingMax = 32;
const suiteController = new AbortController();
const suiteSignal = AbortSignal.any([suiteController.signal, AbortSignal.timeout(180000)]);
const children = new Set();

suiteSignal.addEventListener("abort", () => {
  for (const child of children) child.abort(Error("interop suite timeout"));
});

class Child {
  constructor(name, program, args) {
    this.name = name;
    this.nextId = 1;
    this.pending = new Map();
    this.expired = new Set();
    this.late = [];
    this.events = [];
    this.stderr = "";
    this.stdout = "";
    this.lines = 0;
    this.exited = false;
    children.add(this);
    this.child = spawn(program, args, {cwd: root, stdio: ["pipe", "pipe", "pipe"]});
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      try {
        this.output(chunk);
      } catch (error) {
        this.abort(error);
        suiteController.abort(error);
      }
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-stderrMax);
    });
    this.completion = new Promise((resolveExit) => {
      this.child.once("exit", resolveExit);
      this.child.once("error", (error) => {
        this.abort(error);
        suiteController.abort(error);
        resolveExit();
      });
    });
    this.child.on("exit", (code, signal) => {
      this.exited = true;
      children.delete(this);
      for (const {reject} of this.pending.values())
        reject(Error(`${this.name} exited ${code ?? signal}: ${this.stderr}`));
      this.pending.clear();
    });
  }

  output(chunk) {
    this.stdout += chunk;
    const lines = this.stdout.split("\n");
    this.stdout = lines.pop();
    assert(this.stdout.length <= lineMax, `${this.name} output carry bound`);
    for (const line of lines) {
      if (!line) continue;
      assert(++this.lines <= linesMax && line.length <= lineMax, `${this.name} output bound`);
      const value = JSON.parse(line);
      if (value.event) {
        this.events.push(value);
        continue;
      }
      const pending = this.pending.get(value.id);
      if (!pending && this.expired.delete(value.id)) {
        this.late.push(value);
        continue;
      }
      assert(pending, `${this.name} response without request ${JSON.stringify(value)}`);
      this.pending.delete(value.id);
      if (value.ok) pending.resolve(value);
      else pending.reject(Error(`${this.name}: ${value.error ?? value.err ?? "operation failed"}`));
    }
  }

  command(op, value = {}, timeout = 10000) {
    assert(!this.exited && this.pending.size < pendingMax);
    const id = this.nextId++;
    const request = JSON.stringify({id, op, ...value});
    assert(request.length <= lineMax);
    return new Promise((resolveCommand, reject) => {
      const abort = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        suiteSignal.removeEventListener("abort", abort);
        reject(Error(`${this.name} ${op} aborted`));
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        assert(this.expired.size < pendingMax, `${this.name} late response bound`);
        this.expired.add(id);
        suiteSignal.removeEventListener("abort", abort);
        reject(Error(`${this.name} ${op} timeout`));
      }, timeout);
      this.pending.set(id, {
        reject: (error) => {
          clearTimeout(timer);
          suiteSignal.removeEventListener("abort", abort);
          reject(error);
        },
        resolve: (result) => {
          clearTimeout(timer);
          suiteSignal.removeEventListener("abort", abort);
          resolveCommand(result);
        },
      });
      suiteSignal.addEventListener("abort", abort, {once: true});
      this.child.stdin.write(`${request}\n`, (error) => {
        if (error) abort();
      });
    });
  }

  abort(error) {
    for (const {reject} of this.pending.values()) reject(error);
    this.pending.clear();
    if (!this.exited) this.child.kill("SIGKILL");
  }

  async stop() {
    if (this.exited) return;
    void this.command("shutdown", {}, 2000).catch(() => {});
    await Promise.race([this.completion, delay(2000)]);
    if (!this.exited) {
      this.child.kill("SIGTERM");
      await Promise.race([this.completion, delay(1000)]);
    }
    if (!this.exited) this.child.kill("SIGKILL");
    await this.completion;
  }
}

async function waitFor(predicate, timeout = 10000) {
  const end = Date.now() + timeout;
  for (let turns = 0; turns < 400 && Date.now() < end; turns++) {
    if (await predicate()) return;
    await delay(100, undefined, {signal: suiteSignal});
  }
  throw Error("bounded wait timed out");
}

async function verifyExecutable(path) {
  const resolved = resolve(path);
  assert(!relative(root, resolved).startsWith(".."), "binary escapes repository");
  const info = await stat(resolved);
  assert(info.isFile(), "binary is not a regular file");
  await access(resolved, 1);
  return resolved;
}

export {Child, verifyExecutable, waitFor};
