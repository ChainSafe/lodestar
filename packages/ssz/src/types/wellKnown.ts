import {NumberUintType} from "./uint";
import {BooleanType} from "./boolean";
import {ByteVectorType} from "./byteVector";

export const byteType = new NumberUintType({byteLength: 1});
export const number32Type = new NumberUintType({byteLength: 4});
export const booleanType = new BooleanType();
export const byte32Type = new ByteVectorType({length: 32});

