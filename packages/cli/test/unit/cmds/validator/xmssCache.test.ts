import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import tmp from "tmp";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {interopSecretKey} from "@lodestar/state-transition";
import {fetch, fromHex, sleep} from "@lodestar/utils";
import {Signer, SignerType, XmssSigner} from "@lodestar/validator";
import {toXmssSigners} from "../../../../src/cmds/validator/signers/index.js";
import {devnetXmssTreeSource} from "../../../../src/cmds/validator/signers/xmssCache.js";

const RECORD_SIZE = 14696;
const CACHE_URL = "http://localhost/trees.xmss";

// The devnet mnemonic's key 2
const publicKey = fromHex("0x9fdea071c029316bd6d677e83cf393af28dec171ddcc42b9fbcbaa3d6d1bb428");
const publicParameter = publicKey.subarray(16);

function rangeResponse(init?: RequestInit): Response {
  const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get("Range") ?? "") ?? [];
  expect(Number(end) - Number(start) + 1).toBe(RECORD_SIZE);
  return new Response(Buffer.alloc(RECORD_SIZE, Number(start) / RECORD_SIZE), {status: 206});
}

describe("devnetXmssTreeSource", () => {
  let tmpDir: tmp.DirResult;

  beforeEach(() => {
    tmpDir = tmp.dirSync({unsafeCleanup: true});
  });

  afterEach(() => {
    tmpDir.removeCallback();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads the record of a devnet key, found by its public parameter", async () => {
    const file = path.join(tmpDir.name, "trees.xmss");
    fs.writeFileSync(file, Buffer.concat([0, 1, 2].map((index) => Buffer.alloc(RECORD_SIZE, index))));
    const logger = {warn: vi.fn()};
    const source = await devnetXmssTreeSource(file, [publicParameter, new Uint8Array(16)], logger);

    const found = await source(publicParameter);
    expect(found && Buffer.from(found.publicKey)).toEqual(Buffer.from(publicKey));
    expect(found && Buffer.from(found.trees)).toEqual(Buffer.alloc(RECORD_SIZE, 2));

    expect(await source(new Uint8Array(16))).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("asks again for a record whose request failed", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
      .mockImplementation(async (_url, init) => rangeResponse(init));
    vi.stubGlobal("fetch", fetchMock);
    const logger = {warn: vi.fn()};

    const pending = devnetXmssTreeSource(CACHE_URL, [publicParameter], logger);
    await vi.runAllTimersAsync();
    const found = await (await pending)(publicParameter);

    expect(found && Buffer.from(found.trees)).toEqual(Buffer.alloc(RECORD_SIZE, 2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("has no trees for a key whose record cannot be read", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, {status: 200}));
    vi.stubGlobal("fetch", fetchMock);
    const logger = {warn: vi.fn()};

    const pending = devnetXmssTreeSource(CACHE_URL, [publicParameter], logger);
    await vi.runAllTimersAsync();

    expect(await (await pending)(publicParameter)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe("toXmssSigners", () => {
  let tmpDir: tmp.DirResult;

  beforeEach(() => {
    tmpDir = tmp.dirSync({unsafeCleanup: true});
  });

  afterEach(() => {
    tmpDir.removeCallback();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads the trees of every key before it derives any", async () => {
    const count = 8;
    const devnetPublicKeys = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../pq-devnet-0-xmss-pubkeys.bin")
    );
    const signers: Signer[] = Array.from({length: count}, (_, index) => ({
      type: SignerType.Local,
      secretKey: interopSecretKey(index),
    }));
    const indexOf = (secretKey: Uint8Array): number =>
      signers.findIndex(
        (signer) => signer.type === SignerType.Local && Buffer.from(signer.secretKey.toBytes()).equals(secretKey)
      );
    const parameterOf = (secretKey: Uint8Array): Uint8Array =>
      devnetPublicKeys.subarray(indexOf(secretKey) * 32 + 16, (indexOf(secretKey) + 1) * 32);
    vi.spyOn(XmssSigner, "publicParameterFromBlsSecretKey").mockImplementation(parameterOf);

    let fetched = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await sleep(50);
      fetched++;
      return rangeResponse(init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const fromBlsSecretKey = vi.spyOn(XmssSigner, "fromBlsSecretKey").mockImplementation(async (secretKey, opts) => {
      expect(fetched).toBe(count);
      const found = await opts?.treeSource?.(parameterOf(secretKey));
      expect(found && Buffer.from(found.trees)).toEqual(Buffer.alloc(RECORD_SIZE, indexOf(secretKey)));
      return {publicKey: parameterOf(secretKey)} as XmssSigner;
    });

    const logger = {info: vi.fn(), warn: vi.fn(), error: vi.fn()};
    const xmssSigners = await toXmssSigners(signers, undefined, CACHE_URL, tmpDir.name, logger);

    expect(xmssSigners.map((signer) => signer.type)).toEqual(Array.from({length: count}, () => SignerType.Xmss));
    expect(fromBlsSecretKey).toHaveBeenCalledTimes(count);
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });

  it("asks for no trees of a key whose trees are stored", async () => {
    const secretKey = interopSecretKey(0);
    vi.spyOn(XmssSigner, "hasStoredTrees").mockReturnValue(true);
    const publicParameterFromBlsSecretKey = vi.spyOn(XmssSigner, "publicParameterFromBlsSecretKey");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(XmssSigner, "fromBlsSecretKey").mockResolvedValue({} as XmssSigner);

    const logger = {info: vi.fn(), warn: vi.fn(), error: vi.fn()};
    await toXmssSigners([{type: SignerType.Local, secretKey}], undefined, CACHE_URL, tmpDir.name, logger);

    expect(publicParameterFromBlsSecretKey).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for the trees of a key whose stored trees are invalid", async () => {
    const secretKey = interopSecretKey(0);
    fs.writeFileSync(path.join(tmpDir.name, `${secretKey.toPublicKey().toHex()}.bin`), new Uint8Array(1));
    vi.spyOn(XmssSigner, "publicParameterFromBlsSecretKey").mockReturnValue(publicParameter);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => rangeResponse(init));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(XmssSigner, "fromBlsSecretKey").mockResolvedValue({} as XmssSigner);

    const logger = {info: vi.fn(), warn: vi.fn(), error: vi.fn()};
    await toXmssSigners([{type: SignerType.Local, secretKey}], undefined, CACHE_URL, tmpDir.name, logger);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
