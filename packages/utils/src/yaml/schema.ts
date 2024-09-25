import yml, {FAILSAFE_SCHEMA, Type} from "js-yaml";

import {intType} from "./int.js";

export const schema = FAILSAFE_SCHEMA.extend({
  // @ts-expect-error
  implicit: [yml.types.null as Type, yml.types.bool as Type, intType, yml.types.float as Type],
  explicit: [],
});
