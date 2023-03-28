import http from "node:http";
import {ELRequestPayload, ELResponse} from "../types.js";

export const fetchRequestPayload = async (req: http.IncomingMessage): Promise<ELRequestPayload> => {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body) as ELRequestPayload);
      } catch (err) {
        reject(err);
      }
    });
  });
};

export const fetchResponseBody = async (res: http.IncomingMessage): Promise<ELResponse> => {
  return new Promise((resolve, reject) => {
    let body = "";
    res.on("data", (chunk) => {
      body += chunk;
    });
    res.on("end", () => {
      try {
        resolve(JSON.parse(body) as ELResponse);
      } catch (err) {
        reject(err);
      }
    });
  });
};
