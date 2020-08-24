const path = require('path');

module.exports = {
  root: true,
  env: {
    browser: true,
    es6: true,
    node: true,
    mocha: true
  },
  globals: {
    BigInt: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 10,
    project: "./tsconfig.json"
  },
  plugins: [
    "@typescript-eslint",
    "eslint-plugin-import",
    "eslint-plugin-node",
    "no-only-tests",
    "prettier"
  ],
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "plugin:@typescript-eslint/recommended"
  ],
  settings: {
    "import/resolver": {
      "@mpetrunic/eslint-import-resolver-lerna": {
        packages: path.resolve(__dirname, "packages")
      }
    }
  },
  rules: {
    "prettier/prettier": "error",
    //doesnt work, it reports false errors
    "constructor-super": "off",
    "@typescript-eslint/class-name-casing": "error",
    "@typescript-eslint/explicit-function-return-type": ["error", {
      "allowExpressions": true
    }],
    "@typescript-eslint/func-call-spacing": "error",
    "@typescript-eslint/interface-name-prefix": ["error", "always"],
    "@typescript-eslint/member-ordering": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-require-imports": "error",
    "@typescript-eslint/no-unused-vars": ["error", {
      "varsIgnorePattern": "^_"
    }],
    "@typescript-eslint/ban-ts-ignore": "warn",
    "@typescript-eslint/no-use-before-define": "off",
    "@typescript-eslint/semi": "error",
    "@typescript-eslint/type-annotation-spacing": "error",
    "@typescript-eslint/no-floating-promises": "error",
    //it doesn't recognize module/lib/something (like mainnet & minimal presets)
    "import/no-duplicates": "off",
    "import/no-extraneous-dependencies": ["error", {
      "devDependencies": false,
      "optionalDependencies": false,
      "peerDependencies": false
    }],
    "func-call-spacing": "off",
    //if --fix is run it messes imports like /lib/presets/minimal & /lib/presets/mainnet
    "import/no-duplicates": "off",
    "node/no-deprecated-api": "error",
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
    "quotes": ["error", "double"],
    "semi": "off",

    // Prevents accidentally pushing a commit with .only in Mocha tests
    "no-only-tests/no-only-tests": "error"
  },
  "overrides": [
    {
      "files": ["**/test/**/*.ts"],
      "rules": {
        "import/no-extraneous-dependencies": "off",
        "@typescript-eslint/no-explicit-any": "off"
      }
    }
  ]
};
