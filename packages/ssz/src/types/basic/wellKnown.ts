import {NumberUintType} from "./uint";
import {BooleanType} from "./boolean";

export const byteType = new NumberUintType({byteLength: 1});
export const number32Type = new NumberUintType({byteLength: 4});
export const booleanType = new BooleanType();
