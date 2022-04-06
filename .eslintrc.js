module.exports = {
  root: true,
  env: {
    browser: true,
    es6: true,
    node: true,
    mocha: true,
  },
  globals: {
    BigInt: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    project: "./tsconfig.json",
    sourceType: "module",
  },
  plugins: ["@typescript-eslint", "eslint-plugin-import", "@chainsafe/eslint-plugin-node", "no-only-tests", "prettier"],
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "plugin:@typescript-eslint/recommended",
  ],
  rules: {
    "prettier/prettier": "error",
    //doesnt work, it reports false errors
    "constructor-super": "off",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/naming-convention": [
      "error",
      {selector: "default", format: ["camelCase"]},
      {
        selector: ["classProperty", "objectLiteralProperty", "classMethod", "parameter"],
        format: ["camelCase"],
        leadingUnderscore: "allow",
      },
      //variable must be in camel or upper case
      {selector: "variable", format: ["camelCase", "UPPER_CASE"], leadingUnderscore: "allow"},
      //classes and types must be in PascalCase
      {selector: ["typeLike", "enum"], format: ["PascalCase"]},
      {selector: "enumMember", format: null},
      //interface must start with I
      {selector: "interface", format: ["PascalCase"], prefix: ["I"]},
      //ignore rule for quoted stuff
      {
        selector: [
          "classProperty",
          "objectLiteralProperty",
          "typeProperty",
          "classMethod",
          "objectLiteralMethod",
          "typeMethod",
          "accessor",
          "enumMember",
        ],
        format: null,
        modifiers: ["requiresQuotes"],
      },
      //ignore rules on destructured params
      {
        selector: "variable",
        modifiers: ["destructured"],
        format: null,
      },
    ],
    "@typescript-eslint/explicit-function-return-type": [
      "error",
      {
        allowExpressions: true,
      },
    ],
    "@typescript-eslint/func-call-spacing": "error",
    "@typescript-eslint/member-ordering": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-require-imports": "error",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        varsIgnorePattern: "^_",
        argsIgnorePattern: "^_",
      },
    ],
    "@typescript-eslint/ban-ts-comment": "error",
    "@typescript-eslint/no-use-before-define": "off",
    "@typescript-eslint/semi": "error",
    "@typescript-eslint/type-annotation-spacing": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/explicit-member-accessibility": ["error", {accessibility: "no-public"}],
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-return": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/strict-boolean-expressions": [
      "error",
      {
        allowNullableBoolean: true,
        allowNullableString: true,
        allowAny: true,
      },
    ],
    "import/no-extraneous-dependencies": [
      "error",
      {
        devDependencies: false,
        optionalDependencies: false,
        peerDependencies: false,
      },
    ],
    "func-call-spacing": "off",
    //if --fix is run it messes imports like /lib/presets/minimal & /lib/presets/mainnet
    "import/no-duplicates": "off",
    "import/no-relative-packages": "error",
    "@chainsafe/node/no-deprecated-api": "error",
    "new-parens": "error",
    "no-caller": "error",
    "no-bitwise": "off",
    "no-cond-assign": "error",
    "no-consecutive-blank-lines": 0,
    "no-console": "warn",
    "no-var": "error",
    "object-curly-spacing": ["error", "never"],
    "object-literal-sort-keys": 0,
    "no-prototype-builtins": 0,
    "prefer-const": "error",
    quotes: ["error", "double"],
    semi: "off",
    "no-restricted-imports": [
      "error",
      {
        patterns: ["../lib/*", "@chainsafe/*/lib/*"],
        paths: [
          {name: "child_process", message: "Please use node:child_process instead."},
          {name: "crypto", message: "Please use node:crypto instead."},
          {name: "fs", message: "Please use node:fs instead."},
          {name: "http", message: "Please use node:http instead."},
          {name: "net", message: "Please use node:net instead."},
          {name: "os", message: "Please use node:os instead."},
          {name: "path", message: "Please use node:path instead."},
          {name: "stream", message: "Please use node:stream instead."},
          {name: "util", message: "Please use node:util instead."},
          {name: "url", message: "Please use node:url instead."},
        ],
      },
    ],
    // Force to add names to all functions to ease CPU profiling
    "func-names": ["error", "always"],

    // Prevents accidentally pushing a commit with .only in Mocha tests
    "no-only-tests/no-only-tests": "error",

    // TEMP Disabled while eslint-plugin-import support ESM (Typescript does support it) https://github.com/import-js/eslint-plugin-import/issues/2170
    "import/no-unresolved": "off",

    "@chainsafe/node/file-extension-in-import": [
      "error",
      "always",
      {
        "esm": true
      }
    ],
  },
  settings: {
    "import/core-modules": [
      "node:child_process",
      "node:crypto",
      "node:fs",
      "node:http",
      "node:net",
      "node:os",
      "node:path",
      "node:stream",
      "node:util",
      "node:url",
    ],
  },
  overrides: [
    {
      files: ["**/test/**/*.ts"],
      rules: {
        "import/no-extraneous-dependencies": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "func-names": "off",
      },
    },
    {
      files: ["**/types/**/*.ts"],
      rules: {
        "@typescript-eslint/naming-convention": [
          "off",
          {selector: "interface", prefix: ["I"]},
          {selector: "interface", format: ["PascalCase"], prefix: ["I"]},
        ],
      },
    },
  ],
};
