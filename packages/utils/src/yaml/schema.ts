import yml, {FAILSAFE_SCHEMA, Type} from "js-yaml";

import {intType} from "./int.js";

export const schema = FAILSAFE_SCHEMA.extend({
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  implicit: [yml.types.null as Type, yml.types.bool as Type, intType, yml.types.float as Type],
  explicit: [],
});
