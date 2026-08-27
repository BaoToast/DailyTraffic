import { roadNameMatchKey } from "./road-identity";

const DB_NAME = "traffic-analysis-github-pages";
const DB_VERSION = 2;

export function offlineMode() {
  if (typeof window === "undefined") return false;
  return window.location.hostname.endsWith("github.io") || window.location.protocol === "file:" || Boolean((window as unknown as { __TRAFFIC_OFFLINE__?: boolean }).__TRAFFIC_OFFLINE__);
}

function recordIdentity(record: Record<string, unknown>) {
  return [record.projectId, record.quarter, record.roadId, record.dayType, record.directionCode, record.hour].map(value => String(value ?? "")).join("|");
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "_id" });
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "key" });
      if (!db.objectStoreNames.contains("aliases")) db.createObjectStore("aliases", { keyPath: "_id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function all<T>(storeName: string) {
  const db = await openDb();
  return requestResult(db.transaction(storeName, "readonly").objectStore(storeName).getAll()) as Promise<T[]>;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function offlineFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
  const method = (init?.method ?? "GET").toUpperCase();
  if (url.pathname.endsWith("/api/projects") && method === "GET") return json({ projects: await all<Record<string, unknown>>("projects") });
  if (url.pathname.endsWith("/api/projects") && method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const project = { id: uid(), name: String(body.name ?? "").trim(), code: String(body.code ?? ""), clientName: String(body.clientName ?? ""), role: "owner", updatedAt: new Date().toISOString() };
    if (!project.name) return json({ error: "請輸入計畫名稱" }, 400);
    const db = await openDb(); await requestResult(db.transaction("projects", "readwrite").objectStore("projects").put(project));
    return json({ project }, 201);
  }
  const projectMatch = url.pathname.match(/\/api\/projects\/([^/]+)$/);
  if (projectMatch && method === "PATCH") {
    const id = decodeURIComponent(projectMatch[1]);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const current = (await all<Record<string, unknown>>("projects")).find(project => project.id === id);
    if (!current) return json({ error: "找不到指定計畫" }, 404);
    const name = String(body.name ?? "").trim();
    if (!name) return json({ error: "計畫名稱不可空白" }, 400);
    const project = { ...current, name, code: String(body.code ?? current.code ?? ""), clientName: String(body.clientName ?? current.clientName ?? ""), updatedAt: new Date().toISOString() };
    const db = await openDb();
    await requestResult(db.transaction("projects", "readwrite").objectStore("projects").put(project));
    return json({ project });
  }
  if (projectMatch && method === "DELETE") {
    const id = decodeURIComponent(projectMatch[1]);
    const db = await openDb();
    const [records, files, aliases] = await Promise.all([all<Record<string, unknown>>("records"), all<Record<string, unknown>>("files"), all<Record<string, unknown>>("aliases")]);
    const tx = db.transaction(["projects", "records", "files", "aliases"], "readwrite");
    tx.objectStore("projects").delete(id);
    records.filter(row => row.projectId === id).forEach(row => tx.objectStore("records").delete(String(row._id)));
    files.filter(row => String(row.key ?? "").startsWith(`${id}/`)).forEach(row => tx.objectStore("files").delete(String(row.key)));
    aliases.filter(row => row.projectId === id).forEach(row => tx.objectStore("aliases").delete(String(row._id)));
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    return json({ deleted: true });
  }
  if (url.pathname.endsWith("/api/traffic") && method === "GET") {
    const ids = (url.searchParams.get("projectIds") ?? "").split(",").filter(Boolean);
    const rows = (await all<Record<string, unknown>>("records")).filter(r => ids.includes(String(r.projectId))).map(({ _id: _key, ...r }) => r);
    return json({ rows });
  }
  if (url.pathname.endsWith("/api/files") && method === "POST") {
    const form = init?.body as FormData;
    const file = form.get("file") as File;
    const key = `${String(form.get("projectId"))}/${String(form.get("quarter"))}/${uid()}-${file.name}`;
    const db = await openDb(); await requestResult(db.transaction("files", "readwrite").objectStore("files").put({ key, file, originalName: file.name, savedAt: new Date().toISOString() }));
    return json({ key });
  }
  if (url.pathname.endsWith("/api/import") && method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const db = await openDb(); const existing = await all<Record<string, unknown>>("records");
    const tx = db.transaction("records", "readwrite"), store = tx.objectStore("records");
    const incoming = (body.records ?? []).map((r: Record<string, unknown>) => ({ ...r, projectId: body.projectId, quarter: body.quarter }));
    const incomingKeys = new Set(incoming.map(recordIdentity));
    const replaced = existing.filter(r => incomingKeys.has(recordIdentity(r)));
    replaced.forEach(r => store.delete(String(r._id)));
    incoming.forEach((r: Record<string, unknown>) => store.put({ ...r, _id: recordIdentity(r) }));
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    return json({ importedRows: incoming.length, replacedRows: replaced.length, addedRows: incoming.length - replaced.length });
  }
  if (url.pathname.endsWith("/api/quarters") && method === "PATCH") {
    const body = JSON.parse(String(init?.body ?? "{}")); const db = await openDb(); const rows = await all<Record<string, unknown>>("records");
    const tx = db.transaction("records", "readwrite"), store = tx.objectStore("records");
    rows.filter(r => r.projectId === body.projectId && r.quarter === body.quarter).forEach(r => store.put({ ...r, quarter: body.newQuarter }));
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); return json({ quarter: body.newQuarter });
  }
  if (url.pathname.endsWith("/api/quarters") && method === "DELETE") {
    const body = JSON.parse(String(init?.body ?? "{}")); const db = await openDb(); const rows = await all<Record<string, unknown>>("records");
    const tx = db.transaction("records", "readwrite"), store = tx.objectStore("records");
    rows.filter(r => r.projectId === body.projectId && r.quarter === body.quarter).forEach(r => store.delete(String(r._id)));
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); return json({ deleted: true });
  }
  if (url.pathname.endsWith("/api/roads") && method === "GET") {
    const projectId = url.searchParams.get("projectId") ?? "";
    const aliases = (await all<Record<string, unknown>>("aliases")).filter(a => a.projectId === projectId).map(({ _id: _key, ...a }) => a);
    return json({ aliases });
  }
  if (url.pathname.endsWith("/api/roads") && method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const projectId = String(body.projectId ?? ""), db = await openDb();
    if (body.action === "alias") {
      const aliasName = String(body.aliasName ?? "").normalize("NFKC").trim(), roadId = String(body.roadId ?? "");
      if (!aliasName || !roadId) return json({ error: "請輸入別名並選擇對應路段" }, 400);
      const aliasKey = roadNameMatchKey(aliasName);
      await requestResult(db.transaction("aliases", "readwrite").objectStore("aliases").put({ _id: `${projectId}|${aliasKey}`, projectId, aliasKey, aliasName, roadId }));
      return json({ saved: true });
    }
    const rows = await all<Record<string, unknown>>("records"), aliases = await all<Record<string, unknown>>("aliases"), tx = db.transaction(["records", "aliases"], "readwrite"), store = tx.objectStore("records"), aliasStore = tx.objectStore("aliases");
    /*
     * 這條離線路徑的每一個欄位都要跟線上版（app/api/roads/route.ts）走同一套清理，
     * 否則同一個輸入在兩邊會存成不同的字串，備份搬來搬去就對不起來。
     */
    const clean = (value: unknown) => String(value ?? "").normalize("NFKC").trim();
    const saveOfflineAlias = (aliasName: string, roadId: string) => { const aliasKey = roadNameMatchKey(aliasName); if (aliasKey) aliasStore.put({ _id: `${projectId}|${aliasKey}`, projectId, aliasKey, aliasName, roadId }); };
    /*
     * 方向名稱只適用「路段」。路口的 A～G 是支線，各有自己的名字，
     * 改路口名稱或合併路口時不能拿方向A／方向B去蓋——線上版
     * （app/api/roads/route.ts）與畫面上的即時更新都是這樣做的，
     * 只有這條離線路徑會蓋掉支線A、支線B的名稱，重新整理之後才會發現。
     */
    const isIntersection = body.surveyType === "intersection";
    const renamedDirection = (row: Record<string, unknown>, directionA: string, directionB: string) => {
      if (isIntersection) return row.directionName;
      if (row.directionCode === "A") return directionA;
      if (row.directionCode === "B") return directionB;
      return row.directionName;
    };
    if (body.action === "rename") {
      // 原本是 `String(body.directionA ?? "方向A").trim()`：`??` 擋不住空字串
      // （欄位被清空就寫入空白），也沒有做 NFKC。線上版一直都是 `clean(...) || 預設值`。
      const roadId = String(body.roadId ?? ""), roadName = clean(body.roadName), directionA = clean(body.directionA) || "方向A", directionB = clean(body.directionB) || "方向B";
      if (!roadId || !roadName) return json({ error: "路段名稱不可空白" }, 400);
      const oldName = String(rows.find(r => r.projectId === projectId && r.roadId === roadId)?.roadName ?? "");
      rows.filter(r => r.projectId === projectId && r.roadId === roadId).forEach(r => store.put({ ...r, roadName, directionName: renamedDirection(r, directionA, directionB) }));
      if (oldName && oldName !== roadName) saveOfflineAlias(oldName, roadId);
      if (String(body.aliasName ?? "").trim()) saveOfflineAlias(String(body.aliasName).trim(), roadId);
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      return json({ roadId, roadName, directionA, directionB });
    }
    if (body.action === "merge") {
      // targetRoadName 也補上 NFKC：線上版 route.ts 對它做了，這裡原本沒有。
      const sourceRoadId = String(body.sourceRoadId ?? ""), targetRoadId = String(body.targetRoadId ?? ""), targetRoadName = clean(body.targetRoadName), directionA = clean(body.directionA) || "方向A", directionB = clean(body.directionB) || "方向B";
      if (!sourceRoadId || !targetRoadId || sourceRoadId === targetRoadId || !targetRoadName) return json({ error: "請選擇不同的來源與目標路段" }, 400);
      const oldName = String(rows.find(r => r.projectId === projectId && r.roadId === sourceRoadId)?.roadName ?? "");
      rows.filter(r => r.projectId === projectId && (r.roadId === sourceRoadId || r.roadId === targetRoadId)).forEach(r => store.put({ ...r, roadId: targetRoadId, roadName: targetRoadName, directionName: renamedDirection(r, directionA, directionB) }));
      aliases.filter(a => a.projectId === projectId && a.roadId === sourceRoadId).forEach(a => aliasStore.put({ ...a, roadId: targetRoadId }));
      if (oldName) saveOfflineAlias(oldName, targetRoadId);
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      return json({ merged: true, sourceRoadId, targetRoadId });
    }
    return json({ error: "不支援的路段管理操作" }, 400);
  }
  if (/\/api\/projects\/[^/]+\/members$/.test(url.pathname)) return json({ error: "GitHub Pages 備用版不支援多人即時分享，請改用 GPT Site 或 JSON 備份移轉" }, 501);
  return json({ error: "離線備用版不支援此操作" }, 404);
}

export function appFetch(input: RequestInfo | URL, init?: RequestInit) {
  return offlineMode() ? offlineFetch(input, init) : fetch(input, init);
}
