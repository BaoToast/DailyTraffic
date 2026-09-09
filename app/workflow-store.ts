import { emptyWorkflowState, type WorkflowState } from "./final-workflow.ts";

const DB_NAME = "traffic-analysis-workflow";
const DB_VERSION = 1;

/*
 * 寫入與讀取共用這條鏈。讀取若越過尚未完成的寫入，使用者快速切回原計畫
 * 時可能先載到舊值，隨後又把舊值排進寫入佇列，反而覆蓋剛完成的新資料。
 */
let writeChain: Promise<void> = Promise.resolve();

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("projects"))
        request.result.createObjectStore("projects", { keyPath: "projectId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadWorkflow(projectId: string): Promise<WorkflowState> {
  if (!projectId || typeof indexedDB === "undefined")
    return emptyWorkflowState();
  await writeChain;
  const db = await openDb();
  return new Promise((resolve) => {
    const request = db
      .transaction("projects", "readonly")
      .objectStore("projects")
      .get(projectId);
    request.onsuccess = () => {
      const saved = request.result?.state as Partial<WorkflowState> | undefined;
      const base = emptyWorkflowState();
      resolve(
        saved
          ? {
              ...base,
              ...saved,
              thresholds: { ...base.thresholds, ...(saved.thresholds ?? {}) },
              comparisonReports: saved.comparisonReports ?? [],
            }
          : base,
      );
    };
    request.onerror = () => resolve(emptyWorkflowState());
  });
}

/*
 * ── 所有寫入排成一條鏈 ──────────────────────────────────────
 *
 * 這是一個**真的會掉資料**、而且畫面上完全看不出來的缺陷。
 *
 * saveWorkflow() 每次都自己 openDb() 一次，而 open 是非同步的，
 * 兩次寫入誰的 open 先回來**沒有保證**。而上層是
 *
 *     useEffect(() => { saveWorkflow(activeProject, workflow) },
 *               [activeProject, workflow, workflowReady])
 *
 * ——workflow 每變一次就送一次存檔。使用者連續勾兩個核取方塊時：
 *   ・第一次存「舊的 workflow」、第二次存「新的 workflow」
 *   ・第一次的 open 若比第二次晚回來，第一次的 put 就會**後**落地
 *   ・資料庫裡最後留下的是**舊的**
 * 重新整理之後，剛剛勾的東西不見了，沒有錯誤訊息、沒有任何徵兆。
 *
 * 修法：把寫入串成一條鏈，前一次寫完才開始下一次，順序由**呼叫順序**
 * 決定，與 open() 的回應時間無關。刪除也走同一條鏈——刪除與存檔交錯時
 * 順序一樣不能被打亂。
 *
 * 為什麼不「跳過被後來者取代的那一次」（只寫最後一次）：
 * 那樣先呼叫的那一次會拿到「成功」卻其實沒寫，而如果最後那一次失敗，
 * 就變成兩次都沒進去。寧可多寫一次。
 *
 * 讀取也會先等既有寫入完成，避免快速切回原計畫時讀到尚未更新的舊值。
 *
 * ⚠️ 路口轉向（lib/state-storage.ts）有一模一樣的缺陷，同一天一起修，
 *    兩支的守門測試也刻意用同一種手法（假的 IndexedDB＋顛倒的 open 延遲）。
 *
 * 由 tests/workflow-store-race.test.mjs 釘住（把這條鏈拿掉即紅）。
 */
function enqueueWrite(run: () => Promise<void>): Promise<void> {
  /* 前一次失敗也要繼續排下一次，所以成功與失敗都接上同一個 run。 */
  const next = writeChain.then(run, run);
  writeChain = next.then(
    () => {},
    () => {},
  );
  return next;
}

export function saveWorkflow(projectId: string, state: WorkflowState) {
  if (!projectId || typeof indexedDB === "undefined") return Promise.resolve();
  /* 排隊之前就固定這次呼叫的快照，避免等待期間呼叫端改動巢狀欄位。 */
  const stateSnapshot = structuredClone(state);
  return enqueueWrite(async () => {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put({
        projectId,
        state: stateSnapshot,
        updatedAt: new Date().toISOString(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

export function deleteWorkflow(projectId: string) {
  if (!projectId || typeof indexedDB === "undefined") return Promise.resolve();
  return enqueueWrite(async () => {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}
