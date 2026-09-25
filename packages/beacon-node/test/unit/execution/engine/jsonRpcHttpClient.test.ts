import http from "node:http";
import {AddressInfo} from "node:net";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {HttpRequestTimes, JsonRpcHttpClient} from "../../../../src/execution/engine/jsonRpcHttpClient.js";

describe("execution / engine / jsonRpcHttpClient / request times", () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    // Answers after the request's `delay` param in ms, redirects `/redirect` to `/`, and fails `/error` once read
    server = http.createServer((req, res) => {
      if (req.url === "/redirect") {
        req.resume();
        res.writeHead(307, {location: "/"}).end();
        return;
      }
      if (req.url === "/error") {
        req.resume().on("end", () => res.writeHead(500).end());
        return;
      }
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const {id, params} = JSON.parse(body) as {id: number; params: [number]};
        setTimeout(() => res.end(JSON.stringify({jsonrpc: "2.0", id, result: params[0]})), params[0]);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("records when a traced request is written and answered, not when it is called", async () => {
    const client = new JsonRpcHttpClient([url]);
    const times = new HttpRequestTimes();
    const called = performance.now();
    const traced = client.fetch({method: "delay", params: [50]}, {times});
    const untraced = client.fetch({method: "delay", params: [0]});
    // The request leaves only once the synchronous work after the call ends
    while (performance.now() - called < 30);
    const blockEnd = performance.now();

    expect(await Promise.all([traced, untraced])).toEqual([50, 0]);
    expect(times.sent).toBeGreaterThanOrEqual(blockEnd);
    expect(times.received - times.sent).toBeGreaterThanOrEqual(45);
    expect(times.received).toBeLessThanOrEqual(performance.now());
  });

  it("leaves the times unrecorded when the answered request is a followed redirect's", async () => {
    const client = new JsonRpcHttpClient([`${url}/redirect`]);
    const times = new HttpRequestTimes();
    expect(await client.fetch({method: "delay", params: [5]}, {times})).toBe(5);
    expect(times.sent).toBeNaN();
    expect(times.received).toBeNaN();
  });

  it("leaves the times unrecorded when the request fails before it is written", async () => {
    const client = new JsonRpcHttpClient(["http://127.0.0.1:1"]);
    const times = new HttpRequestTimes();
    const onEnd = vi.fn();
    times.onFirstAttemptEnd = onEnd;
    await expect(client.fetch({method: "delay", params: [0]}, {times})).rejects.toThrow();
    expect(times.sent).toBeNaN();
    expect(times.received).toBeNaN();
    expect(times.firstSent).toBeNaN();
    expect(times.firstAttemptEnded).toBe(true);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("ends the first attempt once when it hands its body to the connection, and keeps its send across retries", async () => {
    const client = new JsonRpcHttpClient([`${url}/error`]);
    const times = new HttpRequestTimes();
    let sentAtEnd = NaN;
    const onEnd = vi.fn(() => {
      sentAtEnd = times.sent;
    });
    times.onFirstAttemptEnd = onEnd;
    await expect(
      client.fetchWithRetries({method: "delay", params: [0]}, {times, retries: 1, retryDelay: 0})
    ).rejects.toThrow();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(times.firstSent).toBe(sentAtEnd);
    expect(times.sent).toBeGreaterThan(times.firstSent);
  });
});
