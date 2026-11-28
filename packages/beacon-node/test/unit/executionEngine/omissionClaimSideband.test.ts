import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import {
  devExtraInclusionListTxs,
  emptyInclusionLists,
  getInclusionLists,
  getOmissionClaims,
  listsFromFlat,
  pollInclusionListVerdict,
  recordInclusionLists,
  recordOmissionClaims,
} from "../../../src/execution/engine/omissionClaimSideband.js";

describe("omissionClaimSideband", () => {
  const blockHash = "0xAB" + "00".repeat(31);
  const claim = {transactionHash: "0x" + "11".repeat(32), evaluationIndex: "0x2"};

  afterEach(() => {
    delete process.env.FOCIL_DEV_EXTRA_IL_TXS;
  });

  it("returns the claims getPayloadV7 recorded for a block hash, case insensitive", () => {
    recordOmissionClaims(blockHash, [claim]);
    expect(getOmissionClaims(blockHash.toLowerCase())).toEqual([claim]);
  });

  it("sends no claims for a payload this node did not build", () => {
    expect(getOmissionClaims("0x" + "ff".repeat(32))).toEqual([]);
  });

  it("keeps one list per committee position", () => {
    expect(emptyInclusionLists()).toHaveLength(INCLUSION_LIST_COMMITTEE_SIZE);
    const lists = listsFromFlat([Uint8Array.of(1), Uint8Array.of(2)]);
    expect(lists).toHaveLength(INCLUSION_LIST_COMMITTEE_SIZE);
    expect(lists[0]).toEqual([Uint8Array.of(1), Uint8Array.of(2)]);
    expect(lists.slice(1).every((list) => list.length === 0)).toBe(true);
  });

  it("returns the grouped lists recorded at import", () => {
    const lists = emptyInclusionLists();
    lists[3] = [Uint8Array.of(0xaa)];
    recordInclusionLists(blockHash, lists);
    expect(getInclusionLists(blockHash)?.[3]).toEqual([Uint8Array.of(0xaa)]);
  });

  it("evicts the oldest entries past 256 block hashes", () => {
    const first = "0x" + "01".padStart(64, "0");
    recordOmissionClaims(first, [claim]);
    for (let i = 2; i <= 258; i++) {
      recordOmissionClaims("0x" + i.toString(16).padStart(64, "0"), []);
    }
    expect(getOmissionClaims(first)).toEqual([]);
  });

  it("reads dev extra inclusion list transactions and drops malformed lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "extra-il-"));
    const file = join(dir, "extra.txt");
    writeFileSync(file, "0x02f8aa\nzz\n0x123\n\n01\n");
    process.env.FOCIL_DEV_EXTRA_IL_TXS = file;
    expect(devExtraInclusionListTxs()).toEqual([Uint8Array.of(0x02, 0xf8, 0xaa), Uint8Array.of(0x01)]);
  });

  it("returns no dev extra transactions when the variable is unset or the file is missing", () => {
    expect(devExtraInclusionListTxs()).toEqual([]);
    process.env.FOCIL_DEV_EXTRA_IL_TXS = "/nonexistent/extra-il.txt";
    expect(devExtraInclusionListTxs()).toEqual([]);
  });

  it("polls the verdict until the engine returns one", async () => {
    const answers: (boolean | null)[] = [null, null, false];
    const ids: string[] = [];
    const engine = {
      getInclusionListVerdict: async (id: string) => {
        ids.push(id);
        return answers.shift() ?? null;
      },
    };
    expect(await pollInclusionListVerdict(engine, "0x01", 1, 10)).toBe(false);
    expect(ids).toEqual(["0x01", "0x01", "0x01"]);
  });

  it("returns null when the verdict stays pending", async () => {
    let calls = 0;
    const engine = {
      getInclusionListVerdict: async () => {
        calls++;
        return null;
      },
    };
    expect(await pollInclusionListVerdict(engine, "0x01", 1, 3)).toBeNull();
    expect(calls).toBe(3);
  });
});
