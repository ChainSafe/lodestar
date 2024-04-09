import {randomBytes} from "node:crypto";
import {ApiError} from "@lodestar/api";
import {fromHex, toHex} from "@lodestar/utils";
import {SimulationAssertion, AssertionMatch, AssertionResult, NodePair} from "../interfaces.js";
import {EL_GENESIS_ACCOUNT, EL_GENESIS_SECRET_KEY, SIM_ENV_CHAIN_ID} from "../constants.js";
import {generateBlobsForTransaction} from "../utils/blobs.js";
import {BlobsEIP4844Transaction} from "../web3js/blobsEIP4844Transaction.js";

const numberOfBlobs = 6;
const sentBlobs: string[] = [];

export function createBlobsAssertion(
  nodes: NodePair[],
  {sendBlobsAtSlot, validateBlobsAt}: {sendBlobsAtSlot: number; validateBlobsAt: number}
): SimulationAssertion<string, string[]> {
  return {
    id: `blobs-${nodes.map((n) => n.id).join("-")}`,
    match: ({slot}) => {
      // Run capture every sendBlobsAtSlot -> validateBlobsAt and validate only at validateBlobsAt
      return slot === validateBlobsAt
        ? AssertionMatch.Capture | AssertionMatch.Assert
        : slot >= sendBlobsAtSlot && slot <= validateBlobsAt
          ? AssertionMatch.Capture
          : AssertionMatch.None;
    },

    async capture({slot, node}) {
      // TODO: Add feature to detect the node index during capture process
      // slot starts from 1, so we add up 1
      if (slot <= numberOfBlobs + 1 && node.id === "node-1") {
        const {blobs, kzgCommitments, blobVersionedHashes, kzgProofs} = generateBlobsForTransaction(1);
        const nonce = await node.execution.provider?.eth.getTransactionCount(EL_GENESIS_ACCOUNT);
        const tx = BlobsEIP4844Transaction.fromTxData({
          chainId: `0x${SIM_ENV_CHAIN_ID.toString(16)}`,
          to: `0x${randomBytes(20).toString("hex")}`,
          gasLimit: "0xc350",
          maxPriorityFeePerGas: "0x3b9aca00",
          maxFeePerGas: "0x3ba26b20",
          maxFeePerBlobGas: "0x3e8",
          value: "0x10000",
          nonce: `0x${(nonce ?? 0).toString(16)}`,
          blobVersionedHashes,
          blobs,
          kzgCommitments,
          kzgProofs,
        });
        const signedTx = tx.sign(fromHex(`0x${EL_GENESIS_SECRET_KEY}`));
        await node.execution.provider?.extended.sendRawTransaction(toHex(signedTx.serialize()));
        sentBlobs.push(...blobs.map((b) => toHex(b)));
      }

      const blobSideCars = await node.beacon.api.beacon.getBlobSidecars(slot);
      ApiError.assert(blobSideCars);

      return blobSideCars.response.data.map((b) => toHex(b.blob));
    },

    assert: async ({store}) => {
      const errors: AssertionResult[] = [];

      const blobs: string[] = [];

      for (let slot = sendBlobsAtSlot; slot <= validateBlobsAt; slot++) {
        blobs.push(...(store[slot] ?? []));
      }

      if (blobs.length !== numberOfBlobs) {
        errors.push([
          "Node does not have right number of blobs",
          {
            expectedBlobs: numberOfBlobs,
            currentBlobs: blobs.length,
          },
        ]);
      }

      for (let i = 0; i < blobs.length; i++) {
        if (blobs[i] !== sentBlobs[i]) {
          errors.push([
            "Node does not have the right blobs",
            {
              expectedBlob: sentBlobs[i],
              currentBlob: blobs[i],
            },
          ]);
        }
      }
      return errors;
    },
  };
}
