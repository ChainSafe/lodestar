import {describe, it, expect} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";

import {SeenGossipBlockInput} from "../../../../src/chain/seenCache/seenGossipBlockInput.js";
import {BlockInputType, GossipedInputType, BlockInput} from "../../../../src/chain/blocks/types.js";

describe("SeenGossipBlockInput", () => {
  const chainConfig = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
  });
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);
  const seenGossipBlockInput = new SeenGossipBlockInput();

  // array of numBlobs, events where events are array of
  // [block|blob11|blob2, pd | bp | null | error string reflecting the expected result]
  const testCases: [string, number, [string, string | null][]][] = [
    ["no blobs", 0, [["block", "pd"]]],
    [
      "1 blob, block first",
      1,
      [
        ["block", "bp"],
        ["blob0", "pd"],
      ],
    ],
    [
      "1 blob, blob first",
      1,
      [
        ["blob0", null],
        ["block", "pd"],
      ],
    ],
    [
      "6 blobs, block first",
      6,
      [
        ["block", "bp"],
        ["blob1", "bp"],
        ["blob0", "bp"],
        ["blob5", "bp"],
        ["blob4", "bp"],
        ["blob2", "bp"],
        ["blob3", "pd"],
      ],
    ],
    [
      "4 blobs, block in mid",
      4,
      [
        ["blob1", null],
        ["blob3", null],
        ["block", "bp"],
        ["blob0", "bp"],
        ["blob2", "pd"],
      ],
    ],
    [
      "3 blobs, block in end",
      3,
      [
        ["blob1", null],
        ["blob0", null],
        ["blob2", null],
        ["block", "pd"],
      ],
    ],
  ];

  // lets start from a random slot to build cases
  let slot = 7456;
  for (const testCase of testCases) {
    const [testName, numBlobs, events] = testCase;

    it(`${testName}`, () => {
      const signedBlock = ssz.deneb.SignedBeaconBlock.defaultValue();
      // assign slot and increment for the next block so as to keep these block testcases distinguished
      // in the cache
      signedBlock.message.slot = slot++;
      signedBlock.message.body.blobKzgCommitments = Array.from({length: numBlobs}, () =>
        ssz.deneb.KZGCommitment.defaultValue()
      );

      // create a dummy signed block header with matching body root
      const bodyRoot = ssz.deneb.BeaconBlockBody.hashTreeRoot(signedBlock.message.body);
      const signedBlockHeader = ssz.phase0.SignedBeaconBlockHeader.defaultValue();
      signedBlockHeader.message.slot = signedBlock.message.slot;
      signedBlockHeader.message.bodyRoot = bodyRoot;

      const blobSidecars = Array.from({length: numBlobs}, (_val, index) => {
        const message = {...ssz.deneb.BlobSidecar.defaultValue(), signedBlockHeader, index};
        return message;
      });

      for (const testEvent of events) {
        const [inputEvent, expectedRes] = testEvent;
        const eventType = inputEvent.includes("block") ? GossipedInputType.block : GossipedInputType.blob;
        const expectedResponseType = parseResponseType(expectedRes);

        try {
          if (eventType === GossipedInputType.block) {
            const blockInputRes = seenGossipBlockInput.getGossipBlockInput(
              config,
              {
                type: GossipedInputType.block,
                signedBlock,
                blockBytes: null,
              },
              null
            );

            if (expectedResponseType instanceof Error) {
              expect.fail(`expected to fail with error: ${expectedResponseType.message}`);
            } else if (expectedResponseType === null) {
              expect(blockInputRes).toBeNull();
            } else {
              expect((blockInputRes.blockInput as BlockInput)?.type).toEqual(expectedResponseType);
            }
          } else {
            const index = parseInt(inputEvent.split("blob")[1] ?? "0");
            const blobSidecar = blobSidecars[index];
            expect(blobSidecar).not.toBeUndefined();

            const blobInputRes = seenGossipBlockInput.getGossipBlockInput(
              config,
              {
                type: GossipedInputType.blob,
                blobSidecar,
                blobBytes: null,
              },
              null
            );

            if (expectedResponseType instanceof Error) {
              expect.fail(`expected to fail with error: ${expectedResponseType.message}`);
            } else if (expectedResponseType === null) {
              expect(blobInputRes.blockInput.block).toBeNull();
              expect(blobInputRes.blockInputMeta.expectedBlobs).toBeNull();
            } else {
              expect((blobInputRes.blockInput as BlockInput)?.type).toEqual(expectedResponseType);
            }
          }
        } catch (e) {
          if (!(e as Error).message.includes("expected to fail with error")) {
            if (!(expectedResponseType instanceof Error)) {
              expect.fail(
                `expected not to fail with response=${expectedResponseType} but errored: ${(e as Error).message}`
              );
            }
          }
        }
      }
    });
  }
});

function parseResponseType(expectedRes: string | null): BlockInputType | null | Error {
  switch (expectedRes) {
    case null:
      return null;
    case "pd":
      return BlockInputType.availableData;
    case "bp":
      return BlockInputType.dataPromise;
    default:
      return Error(expectedRes);
  }
}
