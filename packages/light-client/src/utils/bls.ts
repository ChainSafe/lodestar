import bls, {init} from "@chainsafe/bls/switchable";
import {IBls, Implementation} from "@chainsafe/bls/types";

export function getBls(): IBls {
  return bls;
}

export async function initBls(impl: Implementation = "herumi"): Promise<void> {
  await init(impl);
}
