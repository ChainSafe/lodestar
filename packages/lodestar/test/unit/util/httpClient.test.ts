import {assert} from "chai";

import Axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { HttpClient, HttpClientOptions } from "../../../src/util/httpClient";
import { ILogger, WinstonLogger, LogLevel } from "../../../src/logger";

interface User {
  id?: number;
  name: string;
}

describe("httpClient test", () => {
  let mock: MockAdapter;
  let httpClient: HttpClient
  beforeEach(() => {
    mock = new MockAdapter(Axios);
    const logger: ILogger = new WinstonLogger({level: LogLevel.debug.toString()});
    httpClient = new HttpClient({}, {logger});
  });

  it("should handle successful GET request correctly", async () => {
    mock.onGet("/users/1").reply(
      200, { id: 1, name: "John Smith" }
    )
    let user: User = await httpClient.get<User>("/users/1");
    assert.equal(user.id, 1);
    assert.equal(user.name, "John Smith");
  });

  it("should handle successful POST request correctly", async () => {
    mock.onPost("/users", {name: "New comer"}).reply(200, "The user 'New comer' was saved successfully");
    let result: string = await httpClient.post<User, string>("/users", {name: "New comer"});
    assert.equal(result, "The user 'New comer' was saved successfully");
  });

  it("should handle http status code 404 correctly", async () => {
    try {
      await httpClient.get<User>("/wrong_url");
    } catch(e) {
      assert.equal(e.message, "404");
    }
  });

  it("should handle http status code 500 correctly", async () => {
    mock.onGet("/users/!").reply(
      500, "internal server error"
    );
    try {
      await httpClient.get<User>("/users/!");
    } catch(e) {
      assert.equal(e.message, "500");
    }
  });
})