import {Schema} from 'js-yaml';
import failsafe from "js-yaml/lib/js-yaml/schema/failsafe";
// @ts-ignore
import nullType from "js-yaml/lib/js-yaml/type/null";
// @ts-ignore
import boolType from "js-yaml/lib/js-yaml/type/bool";
// @ts-ignore
import floatType from "js-yaml/lib/js-yaml/type/float";
import {intType} from "./int";

export const schema = new Schema({
  include: [
    failsafe
  ],
  implicit: [
    nullType,
    boolType,
    intType,
    floatType
  ],
  explicit: [
  ]
});
