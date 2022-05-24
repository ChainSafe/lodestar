import yaml from "js-yaml";
const {Schema} = yaml;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import failsafe from "js-yaml/lib/js-yaml/schema/failsafe.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import nullType from "js-yaml/lib/js-yaml/type/null.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import boolType from "js-yaml/lib/js-yaml/type/bool.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import floatType from "js-yaml/lib/js-yaml/type/float.js";
import {intType} from "./int.js";

export const schema = new Schema({
  include: [failsafe],
  implicit: [nullType, boolType, intType, floatType],
  explicit: [],
});
