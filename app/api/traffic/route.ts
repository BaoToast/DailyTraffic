import { env } from "cloudflare:workers";
import { apiError, canAccessProject, requireApiUser } from "../_lib";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const ids = (url.searchParams.get("projectIds") ?? "").split(",").filter(Boolean).slice(0, 20);
    if (!ids.length) return Response.json({ rows: [] });
    for (const id of ids) if (!(await canAccessProject(id, user.userId))) return Response.json({ error: "包含無權限的計畫" }, { status: 403 });
    const placeholders = ids.map(() => "?").join(",");
    const result = await env.DB.prepare(`SELECT project_id AS projectId, quarter, road_id AS roadId, road_name AS roadName, day_type AS dayType, direction_code AS directionCode, direction_name AS directionName, hour_interval AS hour, motorcycle, small_vehicle AS small, large_vehicle AS large, special_vehicle AS special, survey_type AS surveyType, turn_data AS turnData, destination_counts AS destinationCounts, vehicle_counts AS vehicleCounts, vehicle_labels AS vehicleLabels, source_file_name AS sourceFileName, source_sheet_name AS sourceSheetName, source_row AS sourceRow, source_range AS sourceRange FROM traffic_records WHERE project_id IN (${placeholders}) ORDER BY quarter,project_id,road_id,day_type,direction_code,hour_interval`).bind(...ids).all();
    const rows = result.results.map((row: Record<string, unknown>) => ({ ...row, turnData: row.turnData ? JSON.parse(String(row.turnData)) : undefined, destinationCounts: row.destinationCounts ? JSON.parse(String(row.destinationCounts)) : undefined, vehicleCounts: row.vehicleCounts ? JSON.parse(String(row.vehicleCounts)) : undefined, vehicleLabels: row.vehicleLabels ? JSON.parse(String(row.vehicleLabels)) : undefined }));
    return Response.json({ rows });
  } catch (error) { return apiError(error); }
}
