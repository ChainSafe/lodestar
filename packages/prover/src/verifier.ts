import {ELRequestMethod, ELRequestVerifier} from "./interfaces.js";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "./types.js";
import {validateGetBalance} from "./web3_requests/eth_getBalance.js";

// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any
const supportedWeb3Methods: Record<string, ELRequestVerifier<any, any>> = {eth_getBalance: validateGetBalance};

export async function verifyWeb3Response({
  payload,
  response,
  handler,
  rootProvider,
}: {
  payload: ELRequestPayload;
  response: ELResponse | undefined;
  handler: ELRequestMethod;
  rootProvider: ProofProvider;
}): Promise<ELResponse | undefined> {
  const verifier = supportedWeb3Methods[payload.method];

  if (response && verifier !== undefined && !(await verifier({payload, response, handler, rootProvider}))) {
    return {
      ...response,
      error: {
        message: "Response verification failed",
        data: {
          response,
        },
      },
    };
  }

  return response;
}
