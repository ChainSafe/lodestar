import {readFileSync} from "node:fs";
import {afterEach, describe, expect, it, vi} from "vitest";
import {fetch, fromHex} from "@lodestar/utils";
import {encodeJwtToken} from "../../../../src/execution/engine/jwt.js";

const runE2e = process.env.ENGINE_SSZ_GETH_POSITIVE_E2E === "1";
const describeE2e = runE2e ? describe : describe.skip;

afterEach(() => {
  vi.restoreAllMocks();
});

function readJwtHex(): string {
  const path = process.env.ENGINE_SSZ_GETH_JWT ?? "/tmp/geth-jwt.hex";
  return readFileSync(path, "utf8").trim();
}

describeE2e("execution / engine / http.sszPositiveE2e", () => {
  it("gets 200 + binary body from live SSZ REST endpoint on geth PR33926", async () => {
    const jwtSecretHex = readJwtHex();
    const sszUrl = process.env.ENGINE_SSZ_GETH_SSZ_URL ?? "http://127.0.0.1:11552";

    const token = encodeJwtToken({iat: Math.floor(Date.now() / 1000)}, fromHex(jwtSecretHex));

    const res = await fetch(`${sszUrl}/engine/v1/get_client_version`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
      },
      body: new Uint8Array(),
    });

    const bytes = new Uint8Array(await res.arrayBuffer());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/octet-stream");
    expect(bytes.length).toBeGreaterThan(0);

    // first 4 bytes in this legacy geth endpoint payload are count LE uint32
    const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
    expect(count).toBeGreaterThan(0);
  });
});
