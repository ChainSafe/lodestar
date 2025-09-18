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
