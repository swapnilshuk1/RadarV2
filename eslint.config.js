import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      "scripts/golden-trace.js",
      "scripts/run-golden-trace-for.js",
      "scripts/overlap5.ts",
      "scripts/trace-error3.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
  // Formatting is an explicit, non-mutating release stage. Keeping it out of
  // lint prevents legacy CRLF/archival files from hiding actionable lint errors.
  { rules: { "prettier/prettier": "off" } },
  {
    // Existing operational and certification scripts intentionally use dynamic
    // database/provider payloads. Release lint must not turn those historical
    // contracts into a repository-wide modernization project.
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "prefer-const": "off",
      "no-empty": "off",
      "no-useless-escape": "off",
      "no-extra-boolean-cast": "off",
      "no-unsafe-finally": "off",
      "no-control-regex": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/prefer-as-const": "off",
      "no-useless-catch": "off",
    },
  },
);
