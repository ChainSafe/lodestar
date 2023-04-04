import sinon from "sinon";
import {allForks} from "@lodestar/types";
import {ProofProvider} from "../../src/proof_provider/proof_provider.js";

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createProofProviderMock({
  executionPayload,
}: {
  executionPayload: allForks.ExecutionPayload;
}): ProofProvider {
  return ({
    getExecutionPayload: sinon.stub().resolves(executionPayload),
  } as unknown) as ProofProvider;
}
