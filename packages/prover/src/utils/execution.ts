import {ELRequestMethod, ELVerifiedRequestHandler} from "../interfaces.js";
import {ProofProvider} from "../proof_provider/proof_provider.js";
import {ELProof, ELRequestPayload, ELResponse} from "../types.js";
import {ethGetBalance} from "../verified_requests/eth_getBalance.js";

// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any
const supportedELRequests: Record<string, ELVerifiedRequestHandler<any, any>> = {eth_getBalance: ethGetBalance};

export async function processVerifiedELRequest({
  payload,
  handler,
  proofProvider,
}: {
  payload: ELRequestPayload;
  handler: ELRequestMethod;
  proofProvider: ProofProvider;
}): Promise<ELResponse | undefined> {
  const verifiedHandler = supportedELRequests[payload.method];

  if (verifiedHandler !== undefined) {
    return verifiedHandler({payload, handler, rootProvider: proofProvider});
  }

  // eslint-disable-next-line no-console
  console.warn(`Request handler for ${payload.method} is not implemented.`);
  return handler(payload);
}

export async function getELProof(
  handler: ELRequestMethod,
  args: [address: string, storageKeys: string[], block: number | string]
): Promise<ELProof> {
  // TODO: Find better way to generate random id
  const proof = await handler({
    jsonrpc: "2.0",
    method: "eth_getProof",
    params: args,
    id: (Math.random() * 10000).toFixed(0),
  });
  if (!proof) {
    throw new Error("Can not find proof for given address.");
  }
  return proof.result as ELProof;
}
