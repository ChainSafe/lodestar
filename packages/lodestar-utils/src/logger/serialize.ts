import {toJson, toString} from "../json";
import {Context} from "./interface";

export function serializeContext(context?: Context | Error): string {
  const json = toJson(context);

  if (typeof json === "object" && json !== null && !Array.isArray(json) && json.stack) {
    const {stack, ...errJsonData} = json;
    return toString(errJsonData) + "\n" + toString(stack);
  } else {
    return toString(json);
  }
}
