import {VoluntaryExit} from "../../src/types";
import BN from "bn.js";

export function generateEmptyVoluntaryExit(): VoluntaryExit {
    return {
        epoch: new BN(0),
        validatorIndex: new BN(0),
        signature: Buffer.alloc(96)
    }
}
