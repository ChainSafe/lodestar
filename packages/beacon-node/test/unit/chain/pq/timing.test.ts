import fs from "node:fs";
import path from "node:path";
import {zstdDecompressSync} from "node:zlib";
import tmp from "tmp";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {PqTiming} from "../../../../src/chain/pq/timing.js";

describe("PqTiming", () => {
  const config = createBeaconConfig(defaultConfig, new Uint8Array(32));
  let tmpDir: tmp.DirResult;

  beforeEach(() => {
    tmpDir = tmp.dirSync({unsafeCleanup: true});
  });

  afterEach(() => {
    tmpDir.removeCallback();
  });

  function readRun(): {manifest: Record<string, any>; events: Record<string, any>[]} {
    const dir = path.join(tmpDir.name, fs.readdirSync(tmpDir.name)[0]);
    // Past 2^53 the numbers lose their last digits here, which the checks below do not read
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
    const events = (manifest.chunks as {name: string}[]).flatMap(({name}) =>
      zstdDecompressSync(fs.readFileSync(path.join(dir, name)))
        .toString()
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line))
    );
    return {manifest, events};
  }

  function open(): PqTiming {
    return new PqTiming(config, testLogger(), {
      output: tmpDir.name,
      observer: false,
      version: "test",
      proverLogInvRate: 2,
      genesisTime: Math.floor(Date.now() / 1000),
      schedule: {committeeCollectionMs: 1, initialMergeMs: 2, fallbackDeadlineMs: 3},
    });
  }

  it("writes a run that closes whole", async () => {
    const timing = open();
    timing.onGossipMessage(
      {
        kind: "individual",
        id: "0a",
        slot: 3,
        committee: 1,
        subnet: 4,
        bytes: 2500,
        signers: 1,
        dataRoot: new Uint8Array(32),
      },
      Date.now() / 1000 - 0.25,
      "accepted"
    );
    const proof = new Uint8Array([1, 2, 3]);
    await timing.job("initial", 5, 1).run(async () => ({proof}), {records: 2});
    await expect(
      timing.job("committee", 3, 0).run(async (): Promise<{proof: Uint8Array}> => {
        throw Error("no proof");
      })
    ).rejects.toThrow("no proof");
    timing.onProposal(5, {proof, participation: 7, records: 2});
    await timing.close();

    const {manifest, events} = readRun();
    expect(manifest.schema_version).toBe(1);
    expect(manifest.client).toBe("lodestar");
    expect(manifest.ended_unix_ns).toBeGreaterThan(manifest.started_unix_ns);
    expect(manifest.chunks).toEqual([{name: "events-000001.jsonl.zst", bytes: expect.any(Number), first: 1, last: 7}]);
    expect(manifest.recorder_status.submitted_sequence).toBe(7);

    expect(events.map(({seq, kind, outcome}) => [seq, kind, outcome])).toEqual([
      [1, "message_received", undefined],
      [2, "validated", "accepted"],
      [3, "proof_started", "started"],
      [4, "proof_finished", "success"],
      [5, "proof_started", "started"],
      [6, "proof_finished", "failed"],
      [7, "proposal_snapshot", "candidate"],
    ]);
    // A receipt is placed when the message arrived, not when it was recorded
    expect(events[1].receipt_to_validation_ns).toBeGreaterThan(200_000_000);
    expect(events[0].mono_ns).toBeLessThan(events[1].mono_ns);
    expect(events[3]).toMatchObject({
      work: "initial",
      origin: "production",
      slot: 5,
      reference_slot: 3,
      round: 1,
      sequence_id: "production:5",
      records: 2,
      proof_bytes: 3,
      proof_id: "0x039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    });
    expect(events[5]).toMatchObject({work: "committee", reference_slot: 3, round: 0, proof_id: null});
  });

  it("drops and counts what a full queue cannot take", async () => {
    const timing = open();
    for (let i = 0; i < 20_000; i++) timing.emit("status", "filler", {i});
    await timing.close();

    const {manifest, events} = readRun();
    const dropped = 20_000 - events.length;
    expect(dropped).toBeGreaterThan(0);
    expect(manifest.recorder_status.dropped.status).toBe(dropped);
    expect(manifest.recorder_status.last_dropped_sequence).toBe(20_000);
  });
});
