import {afterEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {TimeoutError} from "@lodestar/utils";
import {ExecutionBuilderHttp} from "../../../../src/execution/builder/http.js";
import {IClock} from "../../../../src/util/clock.js";

describe("execution/builder/http submitBlindedBlockNoResponse", () => {
  const config = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
  });
  const slot = 10;
  const signedBlindedBlock = ssz.electra.SignedBlindedBeaconBlock.defaultValue();
  signedBlindedBlock.message.slot = slot;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function getBuilder(msUntilSlotEnd: number, fetch: typeof globalThis.fetch): ExecutionBuilderHttp {
    vi.stubGlobal("fetch", fetch);
    const clock = {msFromSlot: (s: number) => (s === slot + 1 ? -msUntilSlotEnd : 0)} as unknown as IClock;
    return new ExecutionBuilderHttp({enabled: true, url: "http://localhost:8661", timeout: 12000}, config, clock);
  }

  function hangUntilAborted(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return new Promise((_, reject) => {
      const abort = (): void => reject(new DOMException("Aborted", "AbortError"));
      if (init?.signal?.aborted) abort();
      init?.signal?.addEventListener("abort", abort, {once: true});
    });
  }

  it("retries fast failures within the slot", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, {status: 503}))
      .mockResolvedValueOnce(new Response(null, {status: 503}))
      .mockResolvedValueOnce(new Response(null, {status: 202}));
    await getBuilder(5000, fetch).submitBlindedBlockNoResponse({data: signedBlindedBlock});
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("cuts a hanging request at the end of the slot", async () => {
    const fetch = vi.fn(hangUntilAborted);
    const start = Date.now();
    await expect(getBuilder(100, fetch).submitBlindedBlockNoResponse({data: signedBlindedBlock})).rejects.toThrow(
      TimeoutError
    );
    expect(Date.now() - start).toBeLessThan(1000);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not retry once the slot has ended", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, {status: 503}));
    await expect(getBuilder(100, fetch).submitBlindedBlockNoResponse({data: signedBlindedBlock})).rejects.toThrow(
      TimeoutError
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("gives up right away if the slot already ended", async () => {
    const fetch = vi.fn(hangUntilAborted);
    const start = Date.now();
    await expect(getBuilder(0, fetch).submitBlindedBlockNoResponse({data: signedBlindedBlock})).rejects.toThrow(
      TimeoutError
    );
    expect(Date.now() - start).toBeLessThan(500);
  });
});
