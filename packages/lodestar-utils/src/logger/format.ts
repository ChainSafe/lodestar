import {format} from "winston";
import {toJson} from "../json";
import {serializeContext} from "./serialize";

export const humanReadableTemplateFn: Parameters<typeof format.printf>[0] = (info) => {
  const paddingBetweenInfo = 30;

  const infoString = info.module || info.namespace || "";
  const infoPad = paddingBetweenInfo - infoString.length;

  return (
    `${info.timestamp}  [${infoString.toUpperCase()}] ${info.level.padStart(infoPad)}:` +
    ` ${info.message} ${serializeContext(info.context)}` +
    `${info.durationMs ? "- duration=" + info.durationMs + "ms" : ""}`
  );
};

export const humanReadableLogFormat = format.combine(
  format.colorize(),
  format.timestamp({format: "YYYY-MM-DD HH:mm:ss"}),
  format.printf(humanReadableTemplateFn)
);

export const jsonLogFormat = format.combine(
  format.timestamp(),
  format((info) => {
    info.context = toJson(info.context);
    return info;
  })(),
  format.json()
);

export const defaultLogFormat = humanReadableLogFormat;
