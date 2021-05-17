import {Schema} from "js-yaml";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import failsafe from "js-yaml/lib/js-yaml/schema/failsafe";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import nullType from "js-yaml/lib/js-yaml/type/null";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import boolType from "js-yaml/lib/js-yaml/type/bool";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import floatType from "js-yaml/lib/js-yaml/type/float";
import {intType} from "./int";

export const schema = new Schema({
  include: [failsafe],
  implicit: [nullType, boolType, intType, floatType],
  explicit: [],
});
