import {Boolean, phase0} from "./sszTypes.js";

const b = Boolean.serialize(false);
console.log(typeof b, b, Boolean.deserialize(b));

const s = phase0.Balances.toViewDU([1, 2]);
console.log(typeof s, s);

const v = phase0.Balances.hashTreeRoot([1, 2]);
console.log(typeof v, v);
