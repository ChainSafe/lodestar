import {FAILSAFE_SCHEMA} from "js-yaml";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import nullType from "js-yaml/lib/type/null.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import boolType from "js-yaml/lib/type/bool.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import floatType from "js-yaml/lib/type/float.js";
import {intType} from "./int.js";

export const schema = FAILSAFE_SCHEMA.extend({implicit: [nullType, boolType, intType, floatType], explicit: []});
