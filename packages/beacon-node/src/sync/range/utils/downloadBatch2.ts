// Should not be called directly. Only exported for unit testing purposes
// export function compareBlobsByRangeRequestAndResponse(
//   blobRequest: deneb.BlobSidecarsByRangeRequest,
//   blobSidecars: deneb.BlobSidecars,
//   expectedBlobs: Map<Slot, number>
// ): void {
//   const {startSlot, count} = blobRequest;

//   const missingBlobs = new Map<Slot, number[]>();
//   for (let slot = startSlot; slot < startSlot + count; slot++) {
//     const expectedBlobCount = expectedBlobs.get(slot);
//     if (!expectedBlobCount) {
//       throw new DownloadByRangeError({code: DownloadByRangeErrorCode.INVALID_EXPECTED_BLOBS_COUNT, slot});
//     }

//     const receivedBlobs = blobSidecars.filter((blobSidecar) => blobSidecar.signedBlockHeader.message.slot === slot);

//     const missingIndices: number[] = [];
//     for (const index of linspace(0, expectedBlobCount - 1)) {
//       if (!receivedBlobs.includes(index)) {
//         missingIndices.push(index);
//       }
//     }
//     if (missingIndices.length > 0) {
//       missingBlobs.set(slot, missingIndices);
//     }
//   }

//   if (missingBlobs.size() > 0) {
//     let numberMissing = 0;
//     for (const [slot, indices] of missingBlobs.entries()) {
//       numberMissing += indices.length;
//     }

//     throw new DownloadByRangeError({
//       code: DownloadByRangeErrorCode.MISSING_BLOBS,
//       numberMissingß,
//     });
//   }
// }

export function compareColumnsByRangeRequestAndResponse(
  columnRequest: fulu.DataColumnSidecarsByRangeRequest,
  columnSidecars: fulu.DataColumnSidecars
) {
  const {startSlot, count, columns} = columnRequest;
  const extraColumns = new Map<ColumnIndex, Slot[]>();
  const missingColumns = new Map<ColumnIndex, Slot[]>();
  let currentSlot = startSlot;
  let currentSlotIndices = [];

  function checkColumnIndices(slot: Slot) {
    for (const index of columns) {
      if (!currentSlotIndices.includes(index)) {
        const slots = missingColumns.get(index) ?? [];
        slots.push(slot);
        missingColumns.set(index, slots);
      }
    }
  }

  for (const columnSidecar of columnSidecars) {
    const slot = columnSidecar.signedBlockHeader.message.slot;

    // check if we are still collecting columns for the same slot. Sidecars should be delivered in order, once the
    // next slot is found check that the last slot is correct (we got all we expected and no more)
    if (slot !== currentSlot) {
      if (slot !== currentSlot + 1) {
      }
      checkColumnIndices(slot);
      currentSlot = slot;
      currentSlotIndices = [];
    }

    const {index} = columnSidecar;
    // check that columns was requested
    if (!columns.includes(index)) {
      const slots = extraColumns.get(index) ?? [];
      slots.push(slot);
      extraColumns.set(index, slots);
      continue;
    }

    // if slots match and it was a requested column, just push index onto array
    currentSlotIndices.push(index);
  }

  // At the end of the loop there will not be a trigger (different slot found) to check the last slot
  checkColumnIndices(currentSlot);

  if (currentSlot !== startSlot + count) {
    for (let missingSlot = currentSlot + 1; missingSlot <= startSlot + count; missingSlot++) {
      missingColumns.set(missingSlot, columnRequest.columns);
    }
  }

  if (missingColumns) {
    throw new DownloadByRangeError({code: DownloadByRangeErrorCode.MISSING_COLUMNS});
  }
}

type BlockInputsByRangeResponse = {
  startSlot: number;
  endSlot: number;
  missedSlots: number[];
  incomplete: BlockInputByRootRequests;
  complete: number[];
};

async function downloadBlockInputsByRange(
  chain: IBeaconChain,
  network: INetwork,
  peerIdStr: PeerIdStr,
  dataAvailability: DataAvailabilityStatus,
  blocksRequest: phase0.BeaconBlocksByRangeRequest,
  blobRequest?: deneb.BlobSidecarsByRangeRequest,
  columnRequest?: fulu.DataColumnSidecarsByRangeRequest
): BlockInputsByRangeResponse {
  const updatedBlockInputs = new Map<Slot, BlockInput>();
  const errors: {slot: Slot; error: Error}[] = [];

  const requests: Promise[] = [
    network
      .sendBeaconBlocksByRange(peerIdStr, blocksRequest)
      .then((blockResponses) => {
        for (const block of blockResponses) {
          try {
            const blockInput = chain.blockInputCache.getBlockInputByBlock({
              block: block.data,
              peerIdStr,
              dataAvailability,
              seenTimestampSec: Date.now() / 1000,
              source: BlockInputSourceType.byRange,
            });
            if (!updatedBlockInputs.has(block.data.message.slot)) {
              updatedBlockInputs.set(blockInput.getSlot(), blockInput);
            }
          } catch (error) {
            errors.push({slot: block.data.message.slot, error});
          }
        }
      })
      .catch(errors.push),
  ];

  let dataStartSlot = Infinity;
  let dataCount = 0;
  if (dataAvailability === DataAvailabilityStatus.Available) {
    if (blobRequest && columnRequest) {
      throw new Error("Cannot attempt *ByRange request for both blobs and columns on same epoch");
    }

    if (!(blobRequest || columnRequest)) {
      throw new Error("Must attempt *ByRange request for either blobs or columns in an epoch with available data");
    }

    if (blobRequest) {
      dataStartSlot = blobRequest.startSlot;
      dataCount = blobRequest.count;
      requests.push(
        network
          .sendBlobSidecarsByRange(peerIdStr, blobRequest)
          .then((blobResponses) => {
            for (const blobSidecar of blobResponses) {
              const slot = blobSidecar.signedBlockHeader.message.slot;
              try {
                const blockInput = chain.blockInputCache.getBlockInputByBlob({
                  blobSidecar,
                  source: BlockInputSourceType.byRange,
                  seenTimestampSec: Date.now() / 1000,
                  peerIdStr,
                });
                if (!updatedBlockInputs.has(slot)) {
                  updatedBlockInputs.set(slot, blockInput);
                }
              } catch (error) {
                errors.push({error, slot});
              }
            }
          })
          .catch(errors.push)
      );
    }

    if (columnRequest) {
      dataStartSlot = columnRequest.startSlot;
      dataCount = columnRequest.count;
      requests.push(
        network
          .sendDataColumnSidecarsByRange(peerIdStr, columnRequest)
          .then((columnsSidecars) => {
            for (const columnSidecar of columnsSidecars) {
              const slot = columnSidecar.signedBlockHeader.message.slot;
              try {
                const blockInput = chain.blockInputCache.getBlockInputByColumn({
                  columnSidecar,
                  source: BlockInputSourceType.byRange,
                  seenTimestampSec: Date.now() / 1000,
                  peerIdStr,
                });
                if (!updatedBlockInputs.has(slot)) {
                  updatedBlockInputs.set(slot, blockInput);
                }
              } catch (error) {
                errors.push({slot, error});
              }
            }
          })
          .catch(errors.push)
      );
    }
  }

  await Promise.all(requests);

  const missedSlots: number[] = [];
  const incomplete: BlockInputByRootRequests = [];
  const complete: number[] = [];

  const startSlot = Math.min(blocksRequest.startSlot, dataStartSlot);
  const endSlot = Math.max(blocksRequest.startSlot + blocksRequest.count, dataStartSlot + dataCount);
  for (let slot = startSlot; slot < endSlot; slot++) {
    const blockInput = updatedBlockInputs.get(slot);
    if (!blockInput) {
      missedSlots.push(slot);
    } else if (blockInput.isComplete()) {
      complete.push(slot);
    } else {
      incomplete.push(blockInput.getRootRequests());
    }
  }

  return {
    startSlot,
    endSlot,
    missedSlots,
    incomplete,
    complete,
    updated: updatedBlockInputs.values(),
  };
}

async function downloadBlockInputsByRoot(
  chain: IBeaconChain,
  network: INetwork,
  peerIdStr: PeerIdStr,
  dataAvailability: DataAvailabilityStatus,
  requests: BlockInputByRootRequests[]
) {
  const blocksRequest: phase0.BeaconBlocksByRootRequest = [];
  const blobsRequest: phase0.BeaconBlocksByRootRequest = [];
  const columnsRequest: phase0.BeaconBlocksByRootRequest = [];

  for (const {block, blobs, columns} of requests) {
    if (block) {
      blocksRequest.push(block);
    }
    if (blobs) {
      blobsRequest.push(blobs);
    }
    if (columns) {
      columnsRequest.push(columns);
    }
  }

  // TODO check for MAX_REQUEST_BLOCKS or MAX_REQUEST_BLOCKS_DENEB
  if (blocksRequest.length > MAX_REQUEST_BLOCKS) {
    throw new Error("Cannot request more than MAX_REQUEST_BLOCKS");
  }
  if (blobsRequest.length > chain.config.getMaxRequestBlobSidecars()) {
    throw new Error("Cannot request more than MAX_REQUEST_BLOB_SIDECARS");
  }
  if (columnsRequest.length > MAX_REQUEST_DATA_COLUMN_SIDECARS) {
    throw new Error("Cannot request more than MAX_REQUEST_DATA_COLUMN_SIDECARS");
  }

  const responses: Promise[] = [];
  const errors: Error[] = [];
  const updatedBlockInputs = new Map<Slot, BlockInput>();

  if (blocksRequest.length) {
    responses.push(
      network
        .sendBeaconBlocksByRoot(peerIdStr, blocksRequest)
        .then((blocks) => {
          for (const {data} of blocks) {
            try {
              const blockInput = chain.blockInputCache.getBlockInputByBlock({
                block: data,
                peerIdStr,
                dataAvailability,
                seenTimestampSec: Date.now() / 1000,
                source: BlockInputSourceType.byRoot,
              });
              if (!updatedBlockInputs.has(data.message.slot)) {
                updatedBlockInputs.set(blockInput.getSlot(), blockInput);
              }
            } catch (error) {
              errors.push({slot: data.message.slot, error});
            }
          }
        })
        .catch(errors.push)
    );
  }
  if (blobsRequest.length) {
    responses.push(
      network
        .sendBlobSidecarsByRoot(peerIdStr, blocksRequest)
        .then((blobSidecars) => {
          for (const blobSidecar of blobSidecars) {
            const slot = blobSidecar.signedBlockHeader.message.slot;
            try {
              const blockInput = chain.blockInputCache.getBlockInputByBlob({
                blobSidecar,
                source: BlockInputSourceType.byRoot,
                seenTimestampSec: Date.now() / 1000,
                peerIdStr,
              });
              if (!updatedBlockInputs.has(slot)) {
                updatedBlockInputs.set(slot, blockInput);
              }
            } catch (error) {
              errors.push({error, slot});
            }
          }
        })
        .catch(errors.push)
    );
  }
  if (columnsRequest.length) {
    responses.push(
      network
        .sendDataColumnSidecarsByRoot(peerIdStr, blocksRequest)
        .then((columnsSidecars) => {
          for (const columnSidecar of columnsSidecars) {
            const slot = columnSidecar.signedBlockHeader.message.slot;
            try {
              const blockInput = chain.blockInputCache.getBlockInputByColumn({
                columnSidecar,
                source: BlockInputSourceType.byRoot,
                seenTimestampSec: Date.now() / 1000,
                peerIdStr,
              });
              if (!updatedBlockInputs.has(slot)) {
                updatedBlockInputs.set(slot, blockInput);
              }
            } catch (error) {
              errors.push({slot, error});
            }
          }
        })
        .catch(errors.push)
    );
  }

  await Promise.all(responses);

  const complete: number[] = [];
  const incomplete: BlockInputByRootRequests[] = [];

  for (const blockInput of updatedBlockInputs.values()) {
    if (blockInput.isComplete()) complete.push(blockInput.getSlot());
    else incomplete.push(blockInput.getRootRequests());
  }

  return {
    complete,
    incomplete,
  };
}

async function downloadBatch(chain: IBeaconChain, network: INetwork, peerIdStr: string, batch: Batch) {
  const currentEpoch = chain.clock.currentEpoch;
  const batchEpoch = batch.startEpoch;
  const forkName = chain.config.getForkName(batch.startSlot);
  const dataAvailabilityStatus = !isForkPostDeneb(forkName)
    ? DataAvailabilityStatus.PreData
    : batchEpoch >= currentEpoch - chain.config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS
      ? DataAvailabilityStatus.Available
      : DataAvailabilityStatus.OutOfRange;

  const byRangeResponse = await downloadBlockInputsByRange(
    chain,
    network,
    peerIdStr,
    dataAvailabilityStatus,
    batch.getBlocksByRangeRequest(),
    batch.getBlobByRangeRequest(),
    batch.getColumnByRangeRequest()
  );

  const effectiveness = calculateByRangeEffectiveness(byRangeResponse);

  if (effectiveness < BY_RANGE_EFFECTIVENESS_THRESHOLD) {
    throw new Error("ByRange request was ineffective.  Try to reattempt");
  }

  const {startSlot, endSlot, missedSlots, complete: completeByRange, incomplete: incompleteByRange} = byRangeResponse;

  const {complete: completeByRoot, incomplete} = await downloadBlockInputsByRoot(
    chain,
    network,
    peerIdStr,
    incompleteByRange
  );

  return {
    startSlot,
    endSlot,
    missedSlots,
    complete: completeByRange.concat(...completeByRoot).sort((a, b) => a - b),
    incomplete,
  };
}

// export async function downloadBatch2(
//   chain: IBeaconChain,
//   network: INetwork,
//   peerIdStr: PeerIdStr,
//   batch: Batch
// ): Promise<ByRangeDownloadBatchResponse> {
//   chain.config.MAX_REQUEST_BLOB_SIDECARS;
//   const currentEpoch = chain.clock.currentEpoch;
//   const batchEpoch = batch.startEpoch;
//   const dataAvailability =
//     batchEpoch >= currentEpoch - chain.config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS
//       ? DataAvailabilityStatus.Available
//       : DataAvailabilityStatus.OutOfRange;

//   const updated = new Map<string, BlockInput>();
//   const errors: Error[] = [];

//   const byRangeResults = {
//     blocks: {
//       requested: 0,
//       received: 0,
//     },
//     blobs: {
//       requested: 0,
//       received: 0,
//     },
//     columns: {
//       requested: 0,
//       received: 0,
//     },
//   };

//   if (batch.isByRange()) {
//     const byRangeResponses: Promise[] = [];
//     const blockRequestMissedSlots: number[] = [];

//     const blocksRequest = batch.getBlocksByRangeRequest();
//     const {count, startSlot} = blocksRequest;
//     byRangeResults.blocks.requested += count;

//     byRangeResponses.push(
//       network
//         .sendBeaconBlocksByRange(peerIdStr, blocksRequest)
//         .then((blockResponses) => {
//           for (const block of blockResponses) {
//             chain.blockInputCache.getBlockInputByBlock({
//               block: block.data,
//               peerIdStr,
//               dataAvailability,
//               seenTimestampSec: Date.now() / 1000,
//               source: BlockInputSourceType.byRange,
//             });
//           }

//           byRangeResults.blocks.received += blockResponses.length;
//           if (blockResponses.length !== count) {
//             const receivedSlots = blockResponses.map(({data}) => data.message.slot);
//             for (let slot = startSlot; slot < startSlot + count; slot++) {
//               if (!receivedSlots.includes(slot)) {
//                 blockRequestMissedSlots.push(slot);
//               }
//             }
//           }
//         })
//         .catch(errors.push)
//     );

//     const missingBlobs: MissingBlob[] = [];
//     const missingColumns: MissingData[] = [];

//     if (dataAvailability === DataAvailabilityStatus.Available) {
//       if (isForkBlobs(batch.forkName)) {
//         const maxBlobsPerBlock = chain.config.getMaxBlobsPerBlock();
//         let totalBlobsForRequest = 0;

//         network
//           .sendBlobSidecarsByRange(peerIdStr, batch.getBlobByRangeRequest())
//           .then((blobResponses) => {
//             byRangeResults.blobs.received += blobResponses.length;

//             for (const blobSidecar of blobResponses) {
//               const blockInput = chain.blockInputCache.getBlockInputByBlob({
//                 blobSidecar,
//                 source: BlockInputSourceType.byRange,
//                 seenTimestampSec: Date.now() / 1000,
//                 peerIdStr,
//               });

//               totalBlobsForRequest += blockInput.numberOfBlobs() ?? maxBlobsPerBlock;
//               const missing = blockInput.getMissingBlobIndices();
//               if (missing) {
//                 missingBlobs.push(missing);
//               }
//             }

//             byRangeResults.blobs.requested = totalBlobsForRequest;
//           })
//           .catch(errors.push);
//       }

//       if (isForkPostFulu(batch.forkName)) {
//         const columnsByRangeRequest = batch.getColumnByRangeRequest();
//         const {count, columns} = columnsByRangeRequest;
//         byRangeResults.columns.requested += count * columns.length;

//         network
//           .sendDataColumnSidecarsByRange(peerIdStr)
//           .then((columnsSidecars) => {
//             for (const columnSidecar of columnsSidecars) {
//               const blockInput = chain.blockInputCache.getBlockInputByColumn({
//                 columnSidecar,
//                 source: BlockInputSourceType.byRange,
//                 seenTimestampSec: Date.now() / 1000,
//                 peerIdStr,
//               });
//               missingColumns.push(...blockInput.getMissingColumnIndices());
//             }
//           })
//           .catch(errors.push);
//       }
//     }

//     await Promise.all(byRangeResponses);
//   }
// }
