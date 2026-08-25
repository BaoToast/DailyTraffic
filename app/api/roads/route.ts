import { env } from "cloudflare:workers";
import { roadNameMatchKey } from "../../road-identity";
import { apiError, canAccessProject, requireApiUser } from "../_lib";

type RoadBody = {
  action?: "rename" | "alias" | "merge";
  projectId?: string;
  roadId?: string;
  roadName?: string;
  directionA?: string;
  directionB?: string;
  aliasName?: string;
  sourceRoadId?: string;
  targetRoadId?: string;
  targetRoadName?: string;
  surveyType?: "road" | "intersection";
};

const clean = (value: unknown) => String(value ?? "").normalize("NFKC").trim();

async function saveAlias(projectId: string, aliasName: string, roadId: string) {
  const aliasKey = roadNameMatchKey(aliasName);
  if (!aliasKey) return;
  await env.DB.prepare(`INSERT INTO road_aliases (project_id,alias_key,alias_name,road_id)
    VALUES (?,?,?,?) ON CONFLICT(project_id,alias_key) DO UPDATE SET alias_name=excluded.alias_name,road_id=excluded.road_id`)
    .bind(projectId, aliasKey, aliasName, roadId).run();
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    if (!projectId || !(await canAccessProject(projectId, user.userId))) return Response.json({ error: "沒有檢視權限" }, { status: 403 });
    const aliases = await env.DB.prepare("SELECT alias_key AS aliasKey,alias_name AS aliasName,road_id AS roadId FROM road_aliases WHERE project_id=? ORDER BY alias_name").bind(projectId).all();
    return Response.json({ aliases: aliases.results });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json() as RoadBody;
    const projectId = clean(body.projectId);
    if (!projectId || !(await canAccessProject(projectId, user.userId, true))) return Response.json({ error: "沒有編輯權限" }, { status: 403 });

    if (body.action === "alias") {
      const aliasName = clean(body.aliasName), roadId = clean(body.roadId);
      if (!aliasName || !roadId) return Response.json({ error: "請輸入別名並選擇對應路段" }, { status: 400 });
      await saveAlias(projectId, aliasName, roadId);
      return Response.json({ saved: true });
    }

    if (body.action === "rename") {
      const roadId = clean(body.roadId), roadName = clean(body.roadName), directionA = clean(body.directionA) || "方向A", directionB = clean(body.directionB) || "方向B";
      if (!roadId || !roadName) return Response.json({ error: "路段名稱不可空白" }, { status: 400 });
      const old = await env.DB.prepare("SELECT road_name AS roadName FROM traffic_records WHERE project_id=? AND road_id=? LIMIT 1").bind(projectId, roadId).first<{ roadName: string }>();
      if (body.surveyType === "intersection") await env.DB.prepare("UPDATE traffic_records SET road_name=? WHERE project_id=? AND road_id=?").bind(roadName, projectId, roadId).run();
      else await env.DB.prepare("UPDATE traffic_records SET road_name=?,direction_name=CASE direction_code WHEN 'A' THEN ? WHEN 'B' THEN ? ELSE direction_name END WHERE project_id=? AND road_id=?").bind(roadName, directionA, directionB, projectId, roadId).run();
      if (old?.roadName && old.roadName !== roadName) await saveAlias(projectId, old.roadName, roadId);
      if (clean(body.aliasName)) await saveAlias(projectId, clean(body.aliasName), roadId);
      return Response.json({ roadId, roadName, directionA, directionB });
    }

    if (body.action === "merge") {
      const sourceRoadId = clean(body.sourceRoadId), targetRoadId = clean(body.targetRoadId), targetRoadName = clean(body.targetRoadName), directionA = clean(body.directionA) || "方向A", directionB = clean(body.directionB) || "方向B";
      if (!sourceRoadId || !targetRoadId || sourceRoadId === targetRoadId || !targetRoadName) return Response.json({ error: "請選擇不同的來源與目標路段" }, { status: 400 });
      const old = await env.DB.prepare("SELECT road_name AS roadName FROM traffic_records WHERE project_id=? AND road_id=? LIMIT 1").bind(projectId, sourceRoadId).first<{ roadName: string }>();
      /*
       * 合併路段時要把**每一個欄位**都帶過去。
       *
       * 這條 INSERT ... SELECT 原本只複製 17 個欄位，漏掉了後來才加上的
       * vehicle_counts、vehicle_labels（多車種）、destination_counts
       * （路口目的地流向）與 source_file_name/sheet/row/range（原始來源追溯）。
       * 那幾個欄位是 DEFAULT '' NOT NULL，所以合併後的列會被填成空字串——
       * 不會報錯，但**多車種資料、路口流向與來源追溯就這樣消失了**，
       * 而且是在使用者按下「合併」之後才發生，沒有任何提示。
       * tests/api-sql.test.mjs 會比對欄位數與 SELECT 運算式數。
       */
      await env.DB.prepare(`INSERT INTO traffic_records
        (id,survey_id,project_id,quarter,road_id,road_name,day_type,direction_code,direction_name,hour_interval,motorcycle,small_vehicle,large_vehicle,special_vehicle,survey_type,turn_data,destination_counts,vehicle_counts,vehicle_labels,source_file_name,source_sheet_name,source_row,source_range,created_at)
        SELECT id||'-merge-'||substr(hex(randomblob(4)),1,8),survey_id,project_id,quarter,?, ?,day_type,direction_code,
          CASE WHEN ?='intersection' THEN direction_name ELSE CASE direction_code WHEN 'A' THEN ? WHEN 'B' THEN ? ELSE direction_name END END,hour_interval,motorcycle,small_vehicle,large_vehicle,special_vehicle,survey_type,turn_data,destination_counts,vehicle_counts,vehicle_labels,source_file_name,source_sheet_name,source_row,source_range,created_at
        FROM traffic_records WHERE project_id=? AND road_id=? AND 1=1
        ON CONFLICT(survey_id,road_id,day_type,direction_code,hour_interval) DO UPDATE SET
          motorcycle=traffic_records.motorcycle+excluded.motorcycle,
          small_vehicle=traffic_records.small_vehicle+excluded.small_vehicle,
          large_vehicle=traffic_records.large_vehicle+excluded.large_vehicle,
          special_vehicle=traffic_records.special_vehicle+excluded.special_vehicle,
          survey_type=excluded.survey_type,turn_data=excluded.turn_data,
          destination_counts=excluded.destination_counts,vehicle_counts=excluded.vehicle_counts,vehicle_labels=excluded.vehicle_labels,
          source_file_name=excluded.source_file_name,source_sheet_name=excluded.source_sheet_name,source_row=excluded.source_row,source_range=excluded.source_range,
          road_name=excluded.road_name,direction_name=excluded.direction_name`)
        .bind(targetRoadId, targetRoadName, body.surveyType ?? "road", directionA, directionB, projectId, sourceRoadId).run();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM traffic_records WHERE project_id=? AND road_id=?").bind(projectId, sourceRoadId),
        body.surveyType === "intersection" ? env.DB.prepare("UPDATE traffic_records SET road_name=? WHERE project_id=? AND road_id=?").bind(targetRoadName, projectId, targetRoadId) : env.DB.prepare("UPDATE traffic_records SET road_name=?,direction_name=CASE direction_code WHEN 'A' THEN ? WHEN 'B' THEN ? ELSE direction_name END WHERE project_id=? AND road_id=?").bind(targetRoadName, directionA, directionB, projectId, targetRoadId),
        env.DB.prepare("UPDATE road_aliases SET road_id=? WHERE project_id=? AND road_id=?").bind(targetRoadId, projectId, sourceRoadId),
      ]);
      if (old?.roadName) await saveAlias(projectId, old.roadName, targetRoadId);
      return Response.json({ merged: true, sourceRoadId, targetRoadId });
    }

    return Response.json({ error: "不支援的路段管理操作" }, { status: 400 });
  } catch (error) { return apiError(error); }
}
