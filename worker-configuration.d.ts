/*
 * Cloudflare 執行環境的繫結型別。
 *
 * 這份宣告要留在版控裡，乾淨的 `npm ci` 之後才能直接跑完 TypeScript 驗證，
 * 不必依賴本機 Wrangler 產生的檔案。實際的繫結值仍由執行環境注入。
 *
 * 為什麼不直接在 tsconfig 加 `"types": ["@cloudflare/workers-types"]`：
 * 那會把整套 Workers 全域型別載進**所有**檔案，其中的 `Response.json()`
 * 回傳 `unknown` 而不是 DOM 版本的 `any`，於是前端 40 幾處
 * `(await res.json()).projects` 全部變成型別錯誤（實測會從 19 個錯誤
 * 暴增到 66 個）。用不到的型別不該為了修幾個錯誤而牽動整個前端，
 * 所以這裡只宣告本專案實際會用到的名稱。
 */
declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
}
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    BUCKET?: R2Bucket;
    ASSETS?: Fetcher;
  }
}
/** D1 資料庫繫結。只宣告本專案實際呼叫到的介面。 */
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}
/** R2 物件儲存繫結。 */
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
  list(options?: Record<string, unknown>): Promise<{ objects: { key: string }[] }>;
}
interface R2ObjectBody {
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  httpMetadata?: { contentType?: string };
}
/** 靜態資產繫結（ASSETS.fetch）。 */
interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}
