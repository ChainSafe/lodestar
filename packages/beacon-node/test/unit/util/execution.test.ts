import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {EnvelopeReconstructionError, EnvelopeReconstructionErrorCode} from "../../../src/chain/errors/index.js";
import {BeaconDb} from "../../../src/db/beacon.js";
import {ArchivedEnvelopeKind} from "../../../src/db/repositories/index.js";
import {ExecutionPayloadBodyV2} from "../../../src/execution/engine/types.js";
import {IExecutionEngine} from "../../../src/execution/index.js";
import {toSignedBlindedEnvelope} from "../../../src/util/blindedEnvelope.js";
import {
  isRebuildMiss,
  reconstructExecutionPayloadEnvelopes,
  reconstructExecutionPayloadEnvelopesByRange,
} from "../../../src/util/execution.js";
import {startIsolatedTmpBeaconDb} from "../../utils/db.js";
import {generateSignedExecutionPayloadEnvelope, payloadBodiesOf} from "../../utils/typeGenerator.js";

describe("reconstructExecutionPayloadEnvelopesByRange", () => {
  const config = createChainForkConfig({GLOAS_FORK_EPOCH: 0});
  const logger = testLogger();
  let db: BeaconDb;
  let closeDb: () => Promise<void>;
  let getPayloadBodiesByHashV2: ReturnType<typeof vi.fn>;
  let executionEngine: IExecutionEngine;

  beforeEach(async () => {
    ({db, close: closeDb} = await startIsolatedTmpBeaconDb(config, "lodestar-envelope-reconstruct-"));
    getPayloadBodiesByHashV2 = vi.fn();
    executionEngine = {getPayloadBodiesByHashV2} as unknown as IExecutionEngine;
  });

  afterEach(() => closeDb());

  const bodyOf = payloadBodiesOf;

  // Seed the archive with the blinded form (the write seam does this at hot→cold migration).
  async function seed(slot: number): Promise<gloas.SignedExecutionPayloadEnvelope> {
    const full = generateSignedExecutionPayloadEnvelope(slot);
    await db.executionPayloadEnvelopeArchive.put(slot, {
      selector: ArchivedEnvelopeKind.Blinded,
      value: toSignedBlindedEnvelope(full),
    });
    return full;
  }

  // Mock the EL to return each seeded envelope's real bodies (incl. BAL), keyed by blockHash.
  function elServes(fulls: gloas.SignedExecutionPayloadEnvelope[]): void {
    const byHash = new Map(fulls.map((f) => [toRootHex(f.message.payload.blockHash), bodyOf(f)]));
    getPayloadBodiesByHashV2.mockImplementation(async (hashes: string[]) => hashes.map((h) => byHash.get(h) ?? null));
  }

  // Collect the range as deserialized envelopes (the generator yields serialized bytes, as served on the wire),
  // plus the slot the stream stopped short at, if any. Any other error propagates.
  async function rangeWith(
    start: number,
    end: number
  ): Promise<{out: {slot: number; envelope: gloas.SignedExecutionPayloadEnvelope}[]; unservableSlot: number | null}> {
    const out = [];
    try {
      for await (const {slot, envelopeBytes} of reconstructExecutionPayloadEnvelopesByRange(
        db,
        executionEngine,
        logger,
        start,
        end
      )) {
        out.push({slot, envelope: ssz.gloas.SignedExecutionPayloadEnvelope.deserialize(envelopeBytes)});
      }
    } catch (e) {
      if (
        e instanceof EnvelopeReconstructionError &&
        e.type.code === EnvelopeReconstructionErrorCode.RANGE_UNSERVABLE
      ) {
        return {out, unservableSlot: e.type.slot};
      }
      throw e;
    }
    return {out, unservableSlot: null};
  }

  async function range(
    start: number,
    end: number
  ): Promise<{slot: number; envelope: gloas.SignedExecutionPayloadEnvelope}[]> {
    return (await rangeWith(start, end)).out;
  }

  const rejection = async (p: Promise<unknown>): Promise<EnvelopeReconstructionError | null> =>
    p.then(
      () => null,
      (e) => e as EnvelopeReconstructionError
    );

  it("reconstructs a range byte-identically to the originals", async () => {
    const fulls = [await seed(10), await seed(11), await seed(12)];
    elServes(fulls);

    const out = await range(10, 13);

    expect(out.map((o) => o.slot)).toEqual([10, 11, 12]);
    for (const {slot, envelope} of out) {
      const original = fulls.find((f) => f.message.payload.slotNumber === slot);
      if (original === undefined) throw Error(`no seeded envelope for slot ${slot}`);
      expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(envelope, original)).toBe(true);
    }
    // all three slots fit in one batch → a single EL round-trip with all three hashes
    expect(getPayloadBodiesByHashV2).toHaveBeenCalledTimes(1);
    expect(getPayloadBodiesByHashV2).toHaveBeenCalledWith(fulls.map((f) => toRootHex(f.message.payload.blockHash)));
  });

  it("chunks EL fetches at MAX_BODIES_REQUEST (32), not one per slot", async () => {
    const fulls = [];
    for (let slot = 0; slot < 33; slot++) fulls.push(await seed(slot));
    elServes(fulls);

    const out = await range(0, 33);

    expect(out.length).toBe(33);
    // 33 slots → 32 + 1, i.e. two EL round-trips, not 33
    expect(getPayloadBodiesByHashV2).toHaveBeenCalledTimes(2);
    expect(getPayloadBodiesByHashV2.mock.calls[0][0]).toHaveLength(32);
    expect(getPayloadBodiesByHashV2.mock.calls[1][0]).toHaveLength(1);
  });

  // Seed a full entry (--chain.dedupePayloads=false) in the same archive.
  async function seedFull(slot: number): Promise<gloas.SignedExecutionPayloadEnvelope> {
    const full = generateSignedExecutionPayloadEnvelope(slot);
    await db.executionPayloadEnvelopeArchive.put(slot, {selector: ArchivedEnvelopeKind.Full, value: full});
    return full;
  }

  it("interleaves full entries (dedupePayloads=false) in slot order without hitting the EL for them", async () => {
    const fulls = [await seed(10), await seed(12)];
    const archivedFull = await seedFull(11);
    elServes(fulls);

    const out = await range(10, 13);

    expect(out.map((o) => o.slot)).toEqual([10, 11, 12]);
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(out[1].envelope, archivedFull)).toBe(true);
    // only the two blinded entries go to the EL
    expect(getPayloadBodiesByHashV2).toHaveBeenCalledTimes(1);
    expect(getPayloadBodiesByHashV2.mock.calls[0][0]).toHaveLength(2);
    expect(getPayloadBodiesByHashV2.mock.calls[0][0]).not.toContain(toRootHex(archivedFull.message.payload.blockHash));
  });

  it("serves a full-only range without calling the EL", async () => {
    await seedFull(10);
    const out = await range(10, 11);
    expect(out.map((o) => o.slot)).toEqual([10]);
    expect(getPayloadBodiesByHashV2).not.toHaveBeenCalled();
  });

  it("respects the [gte, lt) bounds", async () => {
    elServes([await seed(10), await seed(11), await seed(12)]);
    const out = await range(11, 12);
    expect(out.map((o) => o.slot)).toEqual([11]);
  });

  it("ends the stream at the first slot the EL cannot serve instead of leaving a hole", async () => {
    const fulls = [await seed(10), await seed(11), await seed(12)];
    elServes([fulls[0], fulls[2]]); // EL knows 10 and 12 but not 11
    const {out, unservableSlot} = await rangeWith(10, 13);
    // 12 is servable but a response [10, 12] would look like a hole to a peer that knows 11 is FULL
    expect(out.map((o) => o.slot)).toEqual([10]);
    expect(unservableSlot).toBe(11);
  });

  it("ends the stream on a pre-capella body shape (null withdrawals)", async () => {
    const full = await seed(10);
    getPayloadBodiesByHashV2.mockResolvedValue([{...bodyOf(full), withdrawals: null}]);
    const {out, unservableSlot} = await rangeWith(10, 11);
    expect(out).toEqual([]);
    expect(unservableSlot).toBe(10);
  });

  it.each<[string, Uint8Array | null]>([
    ["null", null],
    ["zero-length", new Uint8Array(0)],
  ])("ends the stream when the EL returns a %s block access list", async (_label, blockAccessList) => {
    const fulls = [await seed(10), await seed(11)];
    getPayloadBodiesByHashV2.mockResolvedValue([bodyOf(fulls[0]), {...bodyOf(fulls[1]), blockAccessList}]);
    const {out, unservableSlot} = await rangeWith(10, 12);
    expect(out.map((o) => o.slot)).toEqual([10]);
    expect(unservableSlot).toBe(11);
  });

  it("reports no unservable slot when the range is simply empty", async () => {
    const {out, unservableSlot} = await rangeWith(10, 12);
    expect(out).toEqual([]);
    expect(unservableSlot).toBeNull();
    expect(getPayloadBodiesByHashV2).not.toHaveBeenCalled();
  });

  it("wraps an EL transport error as ENGINE_UNAVAILABLE (transient)", async () => {
    await seed(10);
    getPayloadBodiesByHashV2.mockRejectedValue(new Error("ECONNREFUSED"));
    const err = await rejection(range(10, 11));
    expect(err).toBeInstanceOf(EnvelopeReconstructionError);
    expect(err?.type.code).toBe(EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE);
    expect(err?.isTransient()).toBe(true);
  });

  it("yields the first batch before an EL failure on the second batch surfaces", async () => {
    const fulls = [];
    for (let slot = 0; slot < 33; slot++) fulls.push(await seed(slot));
    const byHash = new Map(fulls.map((f) => [toRootHex(f.message.payload.blockHash), bodyOf(f)]));
    // First round-trip (32 hashes) succeeds, second (1 hash) fails, the real-world partial-response shape
    getPayloadBodiesByHashV2
      .mockImplementationOnce(async (hashes: string[]) => hashes.map((h) => byHash.get(h) ?? null))
      .mockRejectedValueOnce(new Error("EL went away"));

    const yielded: number[] = [];
    let err: unknown = null;
    try {
      for await (const {slot} of reconstructExecutionPayloadEnvelopesByRange(db, executionEngine, logger, 0, 33)) {
        yielded.push(slot);
      }
    } catch (e) {
      err = e;
    }

    expect(yielded).toHaveLength(32);
    expect(err).toBeInstanceOf(EnvelopeReconstructionError);
    expect((err as EnvelopeReconstructionError).isTransient()).toBe(true);
  });

  it.each<[string, Partial<ExecutionPayloadBodyV2>]>([
    ["transactions", {transactions: [Uint8Array.from([0xff])]}],
    ["withdrawals", {withdrawals: [{index: 99, validatorIndex: 99, address: new Uint8Array(20), amount: 1n}]}],
    ["blockAccessList", {blockAccessList: Uint8Array.from([0xff])}],
  ])("ends the range (no throw) when the EL returns %s that don't match the archived root", async (_f, override) => {
    const fulls = [await seed(10), await seed(11)];
    // 10 mismatches: a local inconsistency, but on the p2p path the peer just sees a short response
    getPayloadBodiesByHashV2.mockResolvedValue([{...bodyOf(fulls[0]), ...override}, bodyOf(fulls[1])]);
    const {out, unservableSlot} = await rangeWith(10, 12);
    expect(out).toEqual([]);
    expect(unservableSlot).toBe(10);
  });

  it("reports a mismatch as a miss carrying BODY_ROOT_MISMATCH on the batch getter path", async () => {
    const full = await seed(10);
    getPayloadBodiesByHashV2.mockResolvedValue([{...bodyOf(full), transactions: [Uint8Array.from([0xff])]}]);
    const [result] = await reconstructExecutionPayloadEnvelopes(executionEngine, [toSignedBlindedEnvelope(full)]);
    if (!isRebuildMiss(result) || result.reason !== "mismatch") throw Error("expected a mismatch miss");
    expect(result.slot).toBe(10);
    expect(result.error.type.code).toBe(EnvelopeReconstructionErrorCode.BODY_ROOT_MISMATCH);
    expect(result.error.isTransient()).toBe(false);
  });

  it("reports an unavailable miss on the batch getter path when the EL cannot serve the bodies", async () => {
    const full = await seed(10);
    getPayloadBodiesByHashV2.mockResolvedValue([null]);
    expect(await reconstructExecutionPayloadEnvelopes(executionEngine, [toSignedBlindedEnvelope(full)])).toEqual([
      {slot: 10, reason: "unavailable"},
    ]);
  });
});

// describe("fetchGetBlobsV1AndBuildSidecars", () => {
//   let denebBlockWithBlobs: ReturnType<typeof generateBlockWithBlobSidecars>;
//   let blobsAndProofs: deneb.BlobAndProof[];
//   let blobMeta: BlobMeta[];
//   const forkName = ForkName.deneb;

//   beforeEach(() => {
//     denebBlockWithBlobs = generateBlockWithBlobSidecars({forkName, count: 6});
//     blobsAndProofs = denebBlockWithBlobs.blobSidecars.map(({blob, kzgProof}) => ({blob, proof: kzgProof}));
//     blobMeta = denebBlockWithBlobs.versionedHashes.map((versionedHash, index) => ({index, versionedHash}) as BlobMeta);
//   });

//   afterEach(() => {
//     vi.resetAllMocks();
//   });

//   it("should call getBlobs with the correct arguments", async () => {
//     const getBlobsMock = vi.fn(() => Promise.resolve(blobsAndProofs));
//     executionEngine = {
//       getBlobs: getBlobsMock,
//     } as unknown as IExecutionEngine;

//     await fetchGetBlobsV1AndBuildSidecars({
//       config,
//       forkName,
//       executionEngine,
//       block: denebBlockWithBlobs.block,
//       blobMeta: blobMeta,
//     });

//     expect(getBlobsMock).toHaveBeenCalledOnce();
//     expect(getBlobsMock).toHaveBeenCalledWith(forkName, denebBlockWithBlobs.versionedHashes);
//   });

//   it("should return empty array when execution engine returns no blobs", async () => {
//     const getBlobsMock = vi.fn(() => Promise.resolve([]));
//     executionEngine = {
//       getBlobs: getBlobsMock,
//     } as unknown as IExecutionEngine;

//     const response = await fetchGetBlobsV1AndBuildSidecars({
//       config,
//       forkName,
//       executionEngine,
//       block: denebBlockWithBlobs.block,
//       blobMeta: blobMeta,
//     });
//     expect(response).toEqual([]);
//   });

//   it("should build valid blob sidecars from execution engine response", async () => {
//     const getBlobsMock = vi.fn(() => Promise.resolve(blobsAndProofs));
//     executionEngine = {
//       getBlobs: getBlobsMock,
//     } as unknown as IExecutionEngine;

//     const response = await fetchGetBlobsV1AndBuildSidecars({
//       config,
//       forkName,
//       executionEngine,
//       block: denebBlockWithBlobs.block,
//       blobMeta: blobMeta,
//     });

//     expect(getBlobsMock).toHaveBeenCalledOnce();
//     expect(response).toBeDefined();
//     expect(response).toBeInstanceOf(Array);
//     expect(response.length).toEqual(blobsAndProofs.length);
//     for (const blobSidecar of response) {
//       blobSidecar.kzgCommitmentInclusionProof;
//       expect(blobSidecar).toHaveProperty("index");
//       expect(blobSidecar.index).toBeTypeOf("number");

//       expect(blobSidecar).toHaveProperty("blob");
//       expect(blobSidecar.blob).toBeInstanceOf(Uint8Array);
//       expect(blobSidecar.blob.length).toEqual(BYTES_PER_BLOB);

//       expect(blobSidecar).toHaveProperty("kzgProof");
//       expect(blobSidecar.kzgProof).toBeInstanceOf(Uint8Array);
//       expect(blobSidecar.kzgProof.length).toEqual(BYTES_PER_PROOF);

//       expect(blobSidecar).toHaveProperty("kzgCommitment");
//       expect(blobSidecar.kzgCommitment).toBeInstanceOf(Uint8Array);
//       expect(blobSidecar.kzgCommitment.length).toEqual(BYTES_PER_COMMITMENT);

//       expect(blobSidecar).toHaveProperty("kzgCommitmentInclusionProof");
//       expect(blobSidecar.kzgCommitmentInclusionProof).toBeInstanceOf(Array);
//       blobSidecar.kzgCommitmentInclusionProof.map((proof) => expect(proof).toBeInstanceOf(Uint8Array));

//       expect(blobSidecar).toHaveProperty("signedBlockHeader");
//       expect(blobSidecar.signedBlockHeader.message.slot).toBe(denebBlockWithBlobs.block.message.slot);
//       expect(blobSidecar.signedBlockHeader.message.proposerIndex).toBe(denebBlockWithBlobs.block.message.proposerIndex);
//       expect(blobSidecar.signedBlockHeader.message.parentRoot).toEqual(denebBlockWithBlobs.block.message.parentRoot);
//       expect(blobSidecar.signedBlockHeader.message.stateRoot).toEqual(denebBlockWithBlobs.block.message.stateRoot);
//     }

//     await expect(
//       validateBlockBlobSidecars(
//         denebBlockWithBlobs.block.message.slot,
//         denebBlockWithBlobs.blockRoot,
//         denebBlockWithBlobs.block.message.body.blobKzgCommitments.length,
//         response
//       )
//     ).resolves.toBeUndefined();
//   });

//   it("should handle partial blob response from execution engine", async () => {
//     const engineResponse: (BlobAndProof | null)[] = [...blobsAndProofs];
//     engineResponse[2] = null;
//     engineResponse[4] = null;
//     const getBlobsMock = vi.fn(() => Promise.resolve(engineResponse));
//     executionEngine = {
//       getBlobs: getBlobsMock,
//     } as unknown as IExecutionEngine;

//     const response = await fetchGetBlobsV1AndBuildSidecars({
//       config,
//       forkName,
//       executionEngine,
//       block: denebBlockWithBlobs.block,
//       blobMeta: blobMeta,
//     });

//     expect(response.length).toEqual(4);
//     expect(response.map(({index}) => index)).toEqual([0, 1, 3, 5]);
//   });
// });

// describe("fetchGetBlobsV2AndBuildSidecars", () => {
//   let fuluBlockWithColumns: ReturnType<typeof generateBlockWithColumnSidecars>;
//   let blobAndProofs: fulu.BlobAndProofV2[];
//   let versionedHashes: Uint8Array[];

//   beforeEach(() => {
//     fuluBlockWithColumns = generateBlockWithColumnSidecars({forkName: ForkName.fulu, returnBlobs: true});
//     // biome-ignore lint/style/noNonNullAssertion: returnBlobs = true
//     const blobs = fuluBlockWithColumns.blobs!;
//     blobAndProofs = blobs.map((b) => kzg.computeCellsAndKzgProofs(b)).map(({proofs}, i) => ({proofs, blob: blobs[i]}));
//     versionedHashes = fuluBlockWithColumns.block.message.body.blobKzgCommitments.map((c) =>
//       kzgCommitmentToVersionedHash(c)
//     );
//   });

//   afterEach(() => {
//     vi.resetAllMocks();
//   });

//   it("should call getBlobs with the correct arguments", async () => {
//     const getBlobsMock = vi.fn(() => Promise.resolve(blobAndProofs));
//     executionEngine = {
//       getBlobs: getBlobsMock,
//     } as unknown as IExecutionEngine;

//     const columnMeta = {
//       missing: fuluBlockWithColumns.columnSidecars.map((c) => c.index),
//       versionedHashes,
//     };

//     await fetchGetBlobsV2AndBuildSidecars({
//       config,
//       executionEngine,
//       forkName: ForkName.fulu,
//       block: fuluBlockWithColumns.block,
//       columnMeta,
//     });

//     expect(getBlobsMock).toHaveBeenCalledOnce();
//     expect(getBlobsMock).toHaveBeenCalledWith(ForkName.fulu, versionedHashes);
//   });

//   it("should return empty array when execution engine returns no response", async () => {
//     const getBlobsMock = vi.fn(() => Promise.resolve(null));
//     executionEngine = {
//       getBlobs: getBlobsMock,
//     } as unknown as IExecutionEngine;

//     const columnMeta = {
//       missing: fuluBlockWithColumns.columnSidecars.map((c) => c.index),
//       versionedHashes,
//     };

//     const result = await fetchGetBlobsV2AndBuildSidecars({
//       config,
//       executionEngine,
//       forkName: ForkName.fulu,
//       block: fuluBlockWithColumns.block,
//       columnMeta,
//     });

//     expect(getBlobsMock).toHaveBeenCalledOnce();
//     expect(result).toEqual([]);
//   });

//   it("should build valid columnSidecars from execution engine blobs", async () => {
//     const getBlobsMock = vi.fn(() => Promise.resolve(blobAndProofs));
//     executionEngine = {
//       getBlobs: getBlobsMock,
//     } as unknown as IExecutionEngine;

//     const columnMeta = {
//       missing: fuluBlockWithColumns.columnSidecars.map((c) => c.index),
//       versionedHashes,
//     };

//     const result = await fetchGetBlobsV2AndBuildSidecars({
//       config,
//       executionEngine,
//       forkName: ForkName.fulu,
//       block: fuluBlockWithColumns.block,
//       columnMeta,
//     });

//     expect(getBlobsMock).toHaveBeenCalledOnce();
//     expect(result).toBeDefined();
//     expect(result).toBeInstanceOf(Array);
//     expect(result.length).toEqual(NUMBER_OF_COLUMNS);

//     // Verify the structure of the returned column sidecars
//     for (const [_, columnSidecar] of Object.entries(result)) {
//       expect(
//         validateBlockDataColumnSidecars(
//           columnSidecar.signedBlockHeader.message.slot,
//           fuluBlockWithColumns.blockRoot,
//           fuluBlockWithColumns.block.message.body.blobKzgCommitments.length,
//           [columnSidecar]
//         )
//       ).resolves.toBeUndefined();
//     }
//   });
// });
