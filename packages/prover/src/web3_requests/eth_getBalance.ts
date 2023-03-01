import {ELRequestVerifier} from "../interfaces.js";
import {getELProof, hexToBuffer, isValidAccount} from "../utils.js";

export const validateGetBalance: ELRequestVerifier<[address: string, block?: number | string]> = async ({
  handler,
  payload,
  rootProvider,
}): Promise<boolean> => {
  const {
    params: [address, block],
  } = payload;
  const blockHashes = rootProvider.getBlockRoots(block ?? "latest");
  const proof = await getELProof(handler, [address, [], block ?? "latest"]);

  return isValidAccount({address: hexToBuffer(address), storageKeys: [], stateRoot: blockHashes.el.stateRoot, proof});
};
