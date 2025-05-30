import {COMPOUNDING_WITHDRAWAL_PREFIX, GENESIS_SLOT, MIN_ACTIVATION_BALANCE} from "@lodestar/params";
import {ValidatorIndex, ssz} from "@lodestar/types";
import {G2_POINT_AT_INFINITY} from "../constants/constants.js";
import {CachedBeaconStateElectra, CachedBeaconStateFulu} from "../types.js";
import {hasEth1WithdrawalCredential} from "./capella.js";


// TODO FULU: Impelment this
export function initializeProposerLookahead(state: CachedBeaconStateFulu): void {

}