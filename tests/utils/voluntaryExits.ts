import {VoluntaryExit} from "../../src/types";
import BN from "bn.js";

export function generateEmptyVoluntaryExit(): VoluntaryExit {
    return {
        epoch: 0,
        validatorIndex: 0,
        signature: Buffer.alloc(96)
    }
}
