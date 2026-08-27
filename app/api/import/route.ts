import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { surveys } from "../../../db/schema";
import { apiError, canAccessProject, requireApiUser } from "../_lib";

type ImportRow = { roadId: string; roadName: string; dayType: "平日" | "假日"; directionCode: string; directionName: string; hour: string; motorcycle: number; small: number; large: number; special: number; surveyType?: "road" | "intersection"; turnData?: unknown; destinationCounts?: unknown; vehicleCounts?: unknown; vehicleLabels?: unknown; sourceFileName?: string; sourceSheetName?: string; sourceRow?: number; sourceRange?: string };

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json() as { projectId?: string; quarter?: string; sourceObjectKeys?: string[]; records?: ImportRow[] };
    const projectId = body.projectId ?? ""; const quarter = body.quarter ?? ""; const records = body.records ?? [];
    if (!projectId || !/^(?:\d{3}|\d{4})Q[1-4]$/.test(quarter) || records.length === 0) return Response.json({ error: "匯入資料不完整" }, { status: 400 });
    if (!(await canAccessProject(projectId, user.userId, true))) return Response.json({ error: "沒有編輯權限" }, { status: 403 });
    const db = getDb();
    const existing = await db.select({ id: surveys.id, sourceObjectKeys: surveys.sourceObjectKeys, sourceFileCount: surveys.sourceFileCount }).from(surveys).where(and(eq(surveys.projectId, projectId), eq(surveys.quarter, quarter))).limit(1);
    const surveyId = existing[0]?.id ?? crypto.randomUUID();
    if (!existing.length) {
      await db.insert(surveys).values({ id: surveyId, projectId, quarter, importedBy: user.userId, sourceFileCount: body.sourceObjectKeys?.length ?? 0, sourceObjectKeys: JSON.stringify(body.sourceObjectKeys ?? []) });
    } else {
      const previousKeys = JSON.parse(existing[0].sourceObjectKeys || "[]") as string[];
      const mergedKeys = [...new Set([...previousKeys, ...(body.sourceObjectKeys ?? [])])];
      await db.update(surveys).set({ sourceFileCount: mergedKeys.length, sourceObjectKeys: JSON.stringify(mergedKeys) }).where(eq(surveys.id, surveyId));
    }
    /*
     * 佔位符數量必須等於欄位數量（23 個）。
     *
     * 這裡原本只有 22 個問號，但欄位有 23 個、bind() 也給了 23 個值，
     * D1 直接回「22 values for 23 columns: SQLITE_ERROR」——
     * GPT Site 版本的**匯入功能整個不能用**，任何檔案都寫不進去。
     * GitHub Pages 版本不經過這條路徑（資料只存在瀏覽器），
     * 所以同一份程式在 Pages 上正常、在 GPT Site 上全毀。
     *
     * 註解一定要放在樣板字串**外面**——寫在裡面的話它就是 SQL 內容的一部分，
     * 裡頭的問號會被當成額外的佔位符。
     *
     * tests/api-sql.test.mjs 會逐一比對每一條 INSERT 的
     * 欄位數 ↔ 佔位符數 ↔ bind() 引數數。
     */
    const statements = records.map((r, index) => env.DB.prepare(`INSERT INTO traffic_records
      (id,survey_id,project_id,quarter,road_id,road_name,day_type,direction_code,direction_name,hour_interval,motorcycle,small_vehicle,large_vehicle,special_vehicle,survey_type,turn_data,destination_counts,vehicle_counts,vehicle_labels,source_file_name,source_sheet_name,source_row,source_range)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(survey_id,road_id,day_type,direction_code,hour_interval) DO UPDATE SET
        road_name=excluded.road_name,direction_name=excluded.direction_name,
        motorcycle=excluded.motorcycle,small_vehicle=excluded.small_vehicle,
        large_vehicle=excluded.large_vehicle,special_vehicle=excluded.special_vehicle,
        survey_type=excluded.survey_type,turn_data=excluded.turn_data,destination_counts=excluded.destination_counts,vehicle_counts=excluded.vehicle_counts,vehicle_labels=excluded.vehicle_labels,
        source_file_name=excluded.source_file_name,source_sheet_name=excluded.source_sheet_name,source_row=excluded.source_row,source_range=excluded.source_range`)
      .bind(`${surveyId}-${crypto.randomUUID()}-${index}`, surveyId, projectId, quarter, r.roadId, r.roadName, r.dayType, r.directionCode, r.directionName, r.hour, Math.max(0, Math.round(r.motorcycle)), Math.max(0, Math.round(r.small)), Math.max(0, Math.round(r.large)), Math.max(0, Math.round(r.special)), r.surveyType ?? "road", r.turnData ? JSON.stringify(r.turnData) : "", r.destinationCounts ? JSON.stringify(r.destinationCounts) : "", r.vehicleCounts ? JSON.stringify(r.vehicleCounts) : "", r.vehicleLabels ? JSON.stringify(r.vehicleLabels) : "", r.sourceFileName ?? "", r.sourceSheetName ?? "", Number(r.sourceRow ?? 0), r.sourceRange ?? ""));
    for (let i=0;i<statements.length;i+=75) await env.DB.batch(statements.slice(i,i+75));
    await env.DB.prepare("PRAGMA optimize").run();
    return Response.json({ surveyId, importedRows: records.length, mode: existing.length ? "merged" : "created" });
  } catch (error) { return apiError(error); }
}
