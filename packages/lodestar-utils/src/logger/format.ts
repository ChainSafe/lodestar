import {format} from "winston";
import {Context} from "./interface";

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
      + ` ${info.message} ${serializeContext(info.context)}`
      + `${info.durationMs? "- duration=" + info.durationMs + "ms": ""}`
    );
  })
);

export function serializeContext(context?: Context|Error): string {
  if(!context) return "";
  if(context instanceof Error) {
    return "Error: " + context.message + "\n" + context.stack;
  }
  if (typeof context === "string") return context;
  if (
    typeof context === "number" || typeof context === "boolean" || Array.isArray(context)
  ) return JSON.stringify(context);
  return Object.keys(context).map((key) => {
    const value = typeof context[key] === "string" ? context[key] : JSON.stringify(context[key]);
    return `${key}=${value}`;
  }).join(", ");
}
