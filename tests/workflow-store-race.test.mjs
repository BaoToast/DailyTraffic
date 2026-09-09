/*
 * ══════════════════════════════════════════════════════════════════
 *  連續存檔的順序（品質與版本資料）
 * ══════════════════════════════════════════════════════════════════
 *
 * 這一支釘住的是一個**真的會掉資料**、而且畫面上完全看不出來的缺陷。
 *
 * app/workflow-store.ts 的 saveWorkflow() 每次都自己 openDb() 一次，
 * 而 open 是非同步的，兩次寫入誰先開好**沒有保證**。上層是
 *
 *     useEffect(() => { saveWorkflow(activeProject, workflow) },
 *               [activeProject, workflow, workflowReady])
 *
 * ——workflow 每變一次就送一次存檔。使用者連續勾兩個核取方塊時：
 *   ・第一次存「舊的」、第二次存「新的」
 *   ・第一次的 open 若比第二次晚回來，第一次的 put 就會**後**落地
 *   ・資料庫裡最後留下的是**舊的**
 * 重新整理之後，剛剛勾的東西不見了，沒有錯誤訊息、沒有任何徵兆。
 *
 * ── 這支測試怎麼證明 ──────────────────────────────────────
 *
 * 用一個假的 indexedDB，讓 open() 的回應時間**故意顛倒**：
 * 第一次等 40ms、第二次 20ms、第三次 0ms。把「偶爾會發生」變成
 * 「一定會發生」，測試才穩定。
 *
 * ★ 紅字證明（2026-09-09 實跑）：把 workflow-store.ts 的排隊拿掉、
 *   還原成 `const db = await openDb()` 直接寫，這支測試立刻紅：
 *     AssertionError: 最後留下的應該是最後一次存的內容
 *     actual:   'A（最舊）'
 *     expected: 'C（最新）'
 *
 * ⚠️ 路口轉向（lib/state-storage.ts）有一模一樣的缺陷，同一天一起修。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function installFakeIndexedDB(openDelays, failWriteIndices = []) {
  const rows = new Map();
  const writeOrder = [];
  let openCount = 0;
  let writeCount = 0;
  const failed = new Set(failWriteIndices);

  const store = {
    put(value) {
      const writeIndex = writeCount;
      writeCount += 1;
      queueMicrotask(() => {
        if (failed.has(writeIndex)) {
          tx.error = new Error(`fake write ${writeIndex} failed`);
          tx.onerror?.();
          return;
        }
        rows.set(value.projectId, value);
        writeOrder.push(value.state);
        tx.oncomplete?.();
      });
      return { onsuccess: null, onerror: null };
    },
    delete(key) {
      const writeIndex = writeCount;
      writeCount += 1;
      queueMicrotask(() => {
        if (failed.has(writeIndex)) {
          tx.error = new Error(`fake write ${writeIndex} failed`);
          tx.onerror?.();
          return;
        }
        rows.delete(key);
        writeOrder.push("(deleted)");
        tx.oncomplete?.();
      });
      return { onsuccess: null, onerror: null };
    },
    get(key) {
      const request = { onsuccess: null, onerror: null, result: undefined };
      queueMicrotask(() => {
        request.result = rows.get(key);
        request.onsuccess?.();
      });
      return request;
    },
  };
  /* 每次 transaction() 都要是新的物件，否則 oncomplete 會互相蓋掉。 */
  let tx = { objectStore: () => store, oncomplete: null, onerror: null, error: null };

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => store,
    transaction() {
      tx = {
        objectStore: () => store,
        oncomplete: null,
        onerror: null,
        error: null,
      };
      return tx;
    },
    close() {},
  };

  const factory = {
    open() {
      const index = openCount;
      openCount += 1;
      const request = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        result: db,
        error: null,
      };
      /*
       * ★ 重點：**故意讓先呼叫的後回來**。
       *   真實瀏覽器裡 open() 的完成順序本來就沒有保證。
       */
      setTimeout(() => request.onsuccess?.(), openDelays[index] ?? 0);
      return request;
    },
  };

  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    value: factory,
    configurable: true,
    writable: true,
  });
  return {
    rows,
    writeOrder,
    restore() {
      if (original) Object.defineProperty(globalThis, "indexedDB", original);
      else delete globalThis.indexedDB;
    },
  };
}

test("連續三次存檔，最後留下的是最後一次的內容（即使 open 的回應順序顛倒）", async () => {
  const fake = installFakeIndexedDB([40, 20, 0]);
  try {
    const { saveWorkflow } = await import("../app/workflow-store.ts");
    await Promise.all([
      saveWorkflow("P1", "A（最舊）"),
      saveWorkflow("P1", "B（中間）"),
      saveWorkflow("P1", "C（最新）"),
    ]);
    assert.equal(
      fake.rows.get("P1")?.state,
      "C（最新）",
      "最後留下的應該是最後一次存的內容",
    );
    assert.deepEqual(
      fake.writeOrder,
      ["A（最舊）", "B（中間）", "C（最新）"],
      "寫入順序必須等於呼叫順序，不可以被 open() 的回應時間打亂",
    );
  } finally {
    fake.restore();
  }
});

test("存檔與刪除交錯時也照呼叫順序執行", async () => {
  const fake = installFakeIndexedDB([30, 0, 0]);
  try {
    const { saveWorkflow, deleteWorkflow } = await import(
      "../app/workflow-store.ts"
    );
    await Promise.all([
      saveWorkflow("P2", "要被刪掉的"),
      deleteWorkflow("P2"),
      saveWorkflow("P2", "刪掉之後又存的"),
    ]);
    assert.equal(
      fake.rows.get("P2")?.state,
      "刪掉之後又存的",
      "刪除排在中間時，最後一次存檔仍然要留下來",
    );
  } finally {
    fake.restore();
  }
});

test("沒有 indexedDB 時不會拋例外（伺服器端算繪與封鎖儲存空間的情形）", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  delete globalThis.indexedDB;
  try {
    const { saveWorkflow, deleteWorkflow } = await import(
      "../app/workflow-store.ts"
    );
    await saveWorkflow("P3", "x");
    await deleteWorkflow("P3");
  } finally {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
  }
});

test("前一次寫入失敗後，佇列不會斷掉，下一次仍可成功保存", async () => {
  const fake = installFakeIndexedDB([0, 0], [0]);
  try {
    const { saveWorkflow } = await import("../app/workflow-store.ts");
    await assert.rejects(saveWorkflow("P4", "第一次會失敗"));
    await saveWorkflow("P4", "失敗後的新資料");
    assert.equal(fake.rows.get("P4")?.state, "失敗後的新資料");
  } finally {
    fake.restore();
  }
});

test("尚有寫入時立刻讀取同一計畫，必須等到最新資料落地", async () => {
  const fake = installFakeIndexedDB([40, 0]);
  try {
    const { emptyWorkflowState } = await import("../app/final-workflow.ts");
    const { loadWorkflow, saveWorkflow } = await import("../app/workflow-store.ts");
    const latest = emptyWorkflowState();
    latest.checkedQuarters = ["115Q1"];
    const saving = saveWorkflow("P5", latest);
    const loading = loadWorkflow("P5");
    const [, loaded] = await Promise.all([saving, loading]);
    assert.deepEqual(loaded.checkedQuarters, ["115Q1"]);
  } finally {
    fake.restore();
  }
});

test("排隊前即固定狀態快照，等待期間的外部改動不會偷換存檔內容", async () => {
  const fake = installFakeIndexedDB([30]);
  try {
    const { emptyWorkflowState } = await import("../app/final-workflow.ts");
    const { saveWorkflow } = await import("../app/workflow-store.ts");
    const state = emptyWorkflowState();
    state.checkedQuarters = ["115Q1"];
    const saving = saveWorkflow("P6", state);
    state.checkedQuarters.push("115Q2");
    await saving;
    assert.deepEqual(fake.rows.get("P6")?.state.checkedQuarters, ["115Q1"]);
  } finally {
    fake.restore();
  }
});

test("切換計畫時只允許已完成該計畫載入的 workflow 寫回", async () => {
  const source = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /workflowLoadedProject\s*===\s*activeProject/,
    "不可只用跨計畫共用的 boolean ready 旗標",
  );
});
