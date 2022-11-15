import {eip4844} from "@lodestar/types";
import {verifyKzgCommitmentsAgainstTransactions} from "../util/index.js";

export function processBlobKzgCommitments(body: eip4844.BeaconBlockBody): void {
  if (!verifyKzgCommitmentsAgainstTransactions(body.executionPayload.transactions, body.blobKzgCommitments)) {
    throw Error("Invalid KZG commitments against transactions");
  }
}
