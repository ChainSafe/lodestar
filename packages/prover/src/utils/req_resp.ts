import http from "node:http";
import {JsonRpcRequestPayload, JsonRpcResponse} from "../types.js";

export const fetchRequestPayload = async (req: http.IncomingMessage): Promise<JsonRpcRequestPayload> => {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body) as JsonRpcRequestPayload);
      } catch (err) {
        reject(err);
      }
    });
  });
};

export const fetchResponseBody = async (res: http.IncomingMessage): Promise<JsonRpcResponse> => {
  return new Promise((resolve, reject) => {
    let body = "";
    res.on("data", (chunk) => {
      body += chunk;
    });
    res.on("end", () => {
      try {
        resolve(JSON.parse(body) as JsonRpcResponse);
      } catch (err) {
        reject(err);
      }
    });
  });
};
