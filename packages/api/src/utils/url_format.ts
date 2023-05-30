export enum TokenType {
  String = "String",
  Variable = "Variable",
}
export type Token = {type: TokenType.String; str: string} | {type: TokenType.Variable; var: string};

type Args = Record<string, string | number>;

export function urlToTokens(path: string): Token[] {
  const tokens: Token[] = [];

  let ptr = 0;
  let inVariable = false;

  for (let i = 0, len = path.length; i < len; i++) {
    switch (path[i]) {
      case "{": {
        if (inVariable) {
          throw Error(`Invalid path variable not closed: ${path}`);
        }
        if (i > ptr) {
          tokens.push({type: TokenType.String, str: path.slice(ptr, i)});
        }
        ptr = i + 1;
        inVariable = true;
        break;
      }

      case "}": {
        if (!inVariable) {
          throw Error(`Invalid path variable not open: ${path}`);
        }
        if (ptr === i) {
          throw Error(`Empty variable: ${path}`);
        }
        tokens.push({type: TokenType.Variable, var: path.slice(ptr, i)});
        inVariable = false;
        ptr = i + 1;
        break;
      }
    }
  }

  if (inVariable) {
    throw Error(`Invalid path variable not closed: ${path}`);
  }

  if (ptr < path.length) {
    tokens.push({type: TokenType.String, str: path.slice(ptr)});
  }

  return tokens;
}

/**
 * Compile a route URL formater with syntax `/path/{var1}/{var2}`.
 * Returns a function that expects an object `{var1: 1, var2: 2}`, and returns`/path/1/2`.
 *
 * It's cheap enough to be neglibible. For the sample input below it costs:
 * - compile: 1010 ns / op
 * - execute: 105 ns / op
 * - execute with template literal: 12 ns / op
 * @param path `/eth/v1/validator/:name/attester/:epoch`
 */
export function compileRouteUrlFormater(path: string): (arg: Args) => string {
  const tokens = urlToTokens(path);

  // Return a faster function if there's not ':' token
  if (tokens.length === 1 && tokens[0].type === TokenType.String) {
    return () => path;
  }

  const fns = tokens.map((token) => {
    switch (token.type) {
      case TokenType.String:
        return () => token.str;

      case TokenType.Variable: {
        const argKey = token.var;
        return (args: Args) => args[argKey];
      }
    }
  });

  return function urlFormater(args: Args) {
    // Don't use .map() or .join(), it's x3 slower
    let s = "";
    for (const fn of fns) s += fn(args);
    return s;
  };
}

/**
 * Converts notation used in OpenAPI spec '/states/{state_id}',
 * into colon notation used by fastify '/states/:state_id'
 */
export function toColonNotationPath(path: string): string {
  const tokens = urlToTokens(path);

  return tokens
    .map((token) => {
      switch (token.type) {
        case TokenType.String:
          return token.str;

        case TokenType.Variable: {
          return `:${token.var}`;
        }
      }
    })
    .join("");
}
