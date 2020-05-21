import {format} from "winston";
import {Context} from "./interface";
import {toHex} from "../bytes";

export const defaultLogFormat = format.combine(
  format.colorize(),
  format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss"
  }),
  format.printf((info) => {
    const paddingBetweenInfo = 30;

    const infoString = (info.module || info.namespace || "");
    const infoPad = paddingBetweenInfo - infoString.length;

    return (
      `${info.timestamp}  [${infoString.toUpperCase()}] ${info.level.padStart(infoPad)}:`
      +` ${info.message} ${serializeContext(info.context)}`
    );
  })
);

export function serializeContext(context?: Context|Error): string {
  if(!context) return "";
  if(context instanceof Error) {
    return context.stack;
  }
  return Object.keys(context).map((key) => {
    let value = "";
    if(Array.isArray(context[key]) || context[key] instanceof Uint8Array) {
      value = toHex(context[key] as Uint8Array);
    } else {
      value = context[key].toString();
    }
    return `${key}=${value}`;
  }).join(", ");
}
