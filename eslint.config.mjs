import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  /*
   * 這些目錄裡的東西**不是原始碼**，不要拿去 lint。
   *
   * 起因（2026-08-27 複查發現）：`npm run lint` 一直是紅的——v20.30 上實測
   * 5687 個錯誤——因為 assets/ 與 github-pages/dist/ 沒有排除，eslint 在檢查
   * vite 壓縮後的 bundle。排除產物後，原始碼仍有 54 個錯誤與 6 個警告，
   * 已依規則性質逐項修正、設定或就地說明豁免。
   * 而 `npm test` 當時沒有跑 lint，所以沒有任何人發現這件事。
   *
   * 現在 `npm test` 會先跑 lint（見 package.json），CI 也就跟著把關了。
   */
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    /* repository 根目錄同時放建置後的網站，那一份是產物不是原始碼 */
    "assets/**",
    "github-pages/dist/**",
    /* `npm run samples` 產生的匿名測試樣本，以及手冊成品 */
    ".samples/**",
    "manuals/**",
    "public/**",
    "next-env.d.ts",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    rules: {
      /*
       * 以底線開頭的名稱是「刻意不用」的佔位（解構時要跳過的欄位、
       * 簽章對得上但用不到的參數）。改名為 _xxx 已經是最清楚的表達方式，
       * 不該再被當成錯誤。沒有底線的才是真的忘了刪。
       */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      /*
       * 這兩條是 React Compiler 的建議，不是正確性問題，而本專案的建置流程
       * 並沒有啟用 React Compiler（vite.config.ts 沒有掛 babel-plugin-react-compiler）。
       *
       * set-state-in-effect：畫面有多處「換計畫就重設編輯中的狀態」，那正是
       * 要在 effect 裡 setState 的情境；照規則改寫要動到十幾個 effect 的結構，
       * 屬於與問題無關的重構，風險遠大於收益。
       * preserve-manual-memoization：規則認為手寫的 useMemo 無法被編譯器保留，
       * 但沒有編譯器時那些 useMemo 是實際生效的最佳化（七叉路口的 SVG 很大）。
       *
       * 姊妹專案「路口轉向」已經做過同樣的取捨（eslint.config.mjs 同一行）。
       * 日後若導入 React Compiler，這兩條要一起打開重新檢視。
       */
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      /*
       * 中文說明字串裡有全形空白（例如手冊頁尾的「　　第 N 頁」），
       * 那是刻意的排版字元，不是打錯。字串、註解、樣板與正規表示式裡放行，
       * 程式碼本體仍然禁止——那才是真的會出事的地方。
       */
      "no-irregular-whitespace": [
        "error",
        {
          skipStrings: true,
          skipComments: true,
          skipRegExps: true,
          skipTemplates: true,
        },
      ],
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
]);

export default eslintConfig;
