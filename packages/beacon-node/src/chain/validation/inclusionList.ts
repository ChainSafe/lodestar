import {electra} from "@lodestar/types";
import {IBeaconChain} from "../interface.js";

export async function validateGossipInclusionList(
  _chain: IBeaconChain,
  _inclusionList: electra.SignedInclusionList
): Promise<void> {}
