import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {LevelDbController} from "@lodestar/db/controller/level";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {
  AttestationByTargetRepository,
  AttestationLowerBoundRepository,
  SlashingProtectionAttestationService,
} from "../../../src/slashingProtection/attestation/index.js";
import {InvalidAttestationErrorCode, SlashingProtection} from "../../../src/slashingProtection/index.js";
import {
  DistanceStoreRepository,
  SurroundAttestationErrorCode,
} from "../../../src/slashingProtection/minMaxSurround/index.js";
import {testLogger} from "../../utils/logger.js";

describe("durable attestation decisions", () => {
  const pubkey = ssz.BLSPubkey.defaultValue();
  const attestation = {sourceEpoch: 5, targetEpoch: 10, signingRoot: Buffer.alloc(32).fill(1)};
  let directory: string;
  let db: LevelDbController;
  let protection: SlashingProtection;
  let records: AttestationByTargetRepository;
  let spans: DistanceStoreRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "lodestar-slashing-atomic-"));
    await open();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
    await rm(directory, {recursive: true, force: true});
  });

  async function open(): Promise<void> {
    db = await LevelDbController.create({name: directory}, {logger: testLogger()});
    protection = new SlashingProtection(db);
    records = new AttestationByTargetRepository(db);
    spans = new DistanceStoreRepository(db);
  }

  function sign(sourceEpoch: number, targetEpoch: number): Promise<void> {
    return protection.checkAndInsertAttestation(pubkey, {...attestation, sourceEpoch, targetEpoch});
  }

  it("commits the record and both span indexes in one synchronous batch", async () => {
    const batch = vi.spyOn(db, "batch");
    await protection.checkAndInsertAttestation(pubkey, attestation);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][1]).toEqual({sync: true});
    expect(await records.get(pubkey, 10)).toEqual(attestation);
    expect(await spans.minSpan.get(pubkey, 4)).toBe(6);
    expect(await spans.maxSpan.get(pubkey, 6)).toBe(4);

    await db.close();
    await open();
    await expect(sign(4, 11)).rejects.toMatchObject({type: {code: InvalidAttestationErrorCode.NEW_SURROUNDS_PREV}});
    await expect(sign(6, 9)).rejects.toMatchObject({type: {code: InvalidAttestationErrorCode.PREV_SURROUNDS_NEW}});
  });

  it.each([false, true])("repairs an old record on retry, with min spans already present: %s", async (hasMinSpan) => {
    await records.set(pubkey, [attestation]);
    if (hasMinSpan) {
      await spans.setBatch(pubkey, {
        minSpan: Array.from({length: 5}, (_, source) => ({source, distance: 10 - source})),
        maxSpan: [],
      });
    }
    await db.close();
    await open();

    await protection.checkAndInsertAttestation(pubkey, attestation);
    await expect(sign(4, 11)).rejects.toMatchObject({type: {code: InvalidAttestationErrorCode.NEW_SURROUNDS_PREV}});
    await expect(sign(6, 9)).rejects.toMatchObject({type: {code: InvalidAttestationErrorCode.PREV_SURROUNDS_NEW}});
  });

  it("does not weaken newer spans or replace stored metadata during a same-root retry", async () => {
    await protection.checkAndInsertAttestation(pubkey, attestation);
    await sign(6, 12);
    const before = await db.entries();
    await protection.checkAndInsertAttestation(pubkey, {...attestation, sourceEpoch: 4});
    expect(await db.entries()).toEqual(before);
    await expect(sign(7, 11)).rejects.toMatchObject({type: {code: InvalidAttestationErrorCode.PREV_SURROUNDS_NEW}});
  });

  it("leaves no partial record or span when the atomic batch is rejected", async () => {
    const failure = new Error("batch write failed");
    vi.spyOn(db, "batch").mockRejectedValueOnce(failure);
    await expect(protection.checkAndInsertAttestation(pubkey, attestation)).rejects.toBe(failure);
    expect(await db.entries()).toEqual([]);
    await expect(protection.checkAndInsertAttestation(pubkey, attestation)).resolves.toBeUndefined();
  });

  it("does not allow repeat signing when the repair write fails", async () => {
    await records.set(pubkey, [attestation]);
    const failure = new Error("durability failed");
    vi.spyOn(db, "batch").mockRejectedValueOnce(failure);
    await expect(protection.checkAndInsertAttestation(pubkey, attestation)).rejects.toBe(failure);
    expect(await spans.minSpan.get(pubkey, 4)).toBeNull();
    await expect(protection.checkAndInsertAttestation(pubkey, attestation)).resolves.toBeUndefined();
  });

  it.each([
    {
      name: "double vote",
      conflict: {...attestation, signingRoot: Buffer.alloc(32).fill(2)},
      code: InvalidAttestationErrorCode.DOUBLE_VOTE,
    },
    {
      name: "surround vote",
      conflict: {...attestation, sourceEpoch: 4, targetEpoch: 11},
      code: InvalidAttestationErrorCode.NEW_SURROUNDS_PREV,
    },
  ])("serializes concurrent $name decisions for equal public key bytes", async ({conflict, code}) => {
    const results = await Promise.allSettled([
      protection.checkAndInsertAttestation(pubkey, attestation),
      protection.checkAndInsertAttestation(Uint8Array.from(pubkey), conflict),
    ]);
    expect(results).toMatchObject([{status: "fulfilled"}, {status: "rejected", reason: {type: {code}}}]);
    expect(await records.getAll(pubkey)).toEqual([attestation]);
  });

  it("continues queued decisions after a failed write", async () => {
    const failure = new Error("write failed");
    vi.spyOn(db, "batch").mockRejectedValueOnce(failure);
    const results = await Promise.allSettled([sign(5, 10), sign(4, 11)]);
    expect(results).toEqual([
      {status: "rejected", reason: failure},
      {status: "fulfilled", value: undefined},
    ]);
    expect(await records.getAll(pubkey)).toEqual([{...attestation, sourceEpoch: 4, targetEpoch: 11}]);
  });

  it("allows other validators to proceed while a write is pending", async () => {
    const started = defer<void>();
    const release = defer<void>();
    const batch = db.batch.bind(db);
    vi.spyOn(db, "batch").mockImplementationOnce(async (...args) => {
      started.resolve();
      await release.promise;
      await batch(...args);
    });
    const pending = protection.checkAndInsertAttestation(pubkey, attestation);
    try {
      await started.promise;
      const otherPubkey = new Uint8Array(48).fill(1);
      await protection.checkAndInsertAttestation(otherPubkey, attestation);
      expect(await records.getAll(otherPubkey)).toEqual([attestation]);
    } finally {
      release.resolve();
      await pending;
    }
  });

  it("serializes imports with signing and makes imported lower bounds durable", async () => {
    const service = new SlashingProtectionAttestationService(db);
    const started = defer<void>();
    const release = defer<void>();
    const getLatest = vi.spyOn(AttestationByTargetRepository.prototype, "getLatest");
    const batch = db.batch.bind(db);
    const writes = vi.spyOn(db, "batch").mockImplementationOnce(async (...args) => {
      started.resolve();
      await release.promise;
      await batch(...args);
    });
    const signing = service.checkAndInsertAttestation(pubkey, attestation);
    await started.promise;
    const imported = service.importAttestations(pubkey, [{...attestation, signingRoot: Buffer.alloc(32).fill(2)}]);
    try {
      expect(getLatest).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      await Promise.all([signing, imported]);
    }
    expect(await records.getAll(pubkey)).toEqual([{...attestation, signingRoot: Buffer.alloc(32)}]);
    expect(await new AttestationLowerBoundRepository(db).get(pubkey)).toEqual({minSourceEpoch: 5, minTargetEpoch: 10});
    for (const [, options] of writes.mock.calls) expect(options).toEqual({sync: true});
  });

  it("imports an entire validator history in one synchronous batch", async () => {
    const history = Array.from({length: 64}, (_, i) => ({...attestation, sourceEpoch: 5 + i, targetEpoch: 10 + i}));
    const batch = vi.spyOn(db, "batch");
    await new SlashingProtectionAttestationService(db).importAttestations(pubkey, history);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][1]).toEqual({sync: true});

    await db.close();
    await open();
    expect(await records.getAll(pubkey)).toEqual(history);
    expect(await new AttestationLowerBoundRepository(db).get(pubkey)).toEqual({minSourceEpoch: 5, minTargetEpoch: 10});
    await expect(sign(4, 74)).rejects.toMatchObject({type: {code: InvalidAttestationErrorCode.NEW_SURROUNDS_PREV}});
    await expect(sign(6, 9)).rejects.toMatchObject({type: {code: InvalidAttestationErrorCode.PREV_SURROUNDS_NEW}});
  });

  it.each([false, true])(
    "rejects conflicts within an import without persisting spans, reversed: %s",
    async (reverse) => {
      const history = [attestation, {...attestation, sourceEpoch: 4, targetEpoch: 11}];
      if (reverse) history.reverse();
      history.push({...attestation, sourceEpoch: 6, targetEpoch: 12});
      const before = await db.entries();
      await expect(
        new SlashingProtectionAttestationService(db).importAttestations(pubkey, history)
      ).rejects.toMatchObject({
        type: {
          code: reverse ? SurroundAttestationErrorCode.IS_SURROUNDED : SurroundAttestationErrorCode.IS_SURROUNDING,
        },
      });
      expect(await db.entries()).toEqual(before);
    }
  );

  it("leaves records, spans and lower bounds unchanged when an import batch is rejected", async () => {
    await protection.checkAndInsertAttestation(pubkey, attestation);
    const before = await db.entries();
    const failure = new Error("batch write failed");
    vi.spyOn(db, "batch").mockRejectedValueOnce(failure);
    await expect(
      new SlashingProtectionAttestationService(db).importAttestations(pubkey, [
        {...attestation, sourceEpoch: 6, targetEpoch: 12},
      ])
    ).rejects.toBe(failure);
    expect(await db.entries()).toEqual(before);
  });
});
