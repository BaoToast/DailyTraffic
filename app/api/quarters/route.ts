import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { surveys } from "../../../db/schema";
import { apiError, canAccessProject, requireApiUser } from "../_lib";

const validQuarter = (value: string) => /^(?:\d{3}|\d{4})Q[1-4]$/.test(value);

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json() as { projectId?: string; quarter?: string; newQuarter?: string };
    const projectId = String(body.projectId ?? "");
    const quarter = String(body.quarter ?? "").toUpperCase();
    const newQuarter = String(body.newQuarter ?? "").toUpperCase();
    if (!projectId || !validQuarter(quarter) || !validQuarter(newQuarter)) return Response.json({ error: "季度格式須為115Q2或2026Q2" }, { status: 400 });
    if (!(await canAccessProject(projectId, user.userId, true))) return Response.json({ error: "沒有編輯權限" }, { status: 403 });
    const db = getDb();
    const source = await db.select({ id: surveys.id }).from(surveys).where(and(eq(surveys.projectId, projectId), eq(surveys.quarter, quarter))).limit(1);
    if (!source.length) return Response.json({ error: "找不到指定季度" }, { status: 404 });
    const target = await db.select({ id: surveys.id }).from(surveys).where(and(eq(surveys.projectId, projectId), eq(surveys.quarter, newQuarter))).limit(1);
    if (target.length) return Response.json({ error: `${newQuarter} 已存在，請先清除或改用其他名稱` }, { status: 409 });
    await env.DB.batch([
      env.DB.prepare("UPDATE surveys SET quarter=? WHERE id=?").bind(newQuarter, source[0].id),
      env.DB.prepare("UPDATE traffic_records SET quarter=? WHERE project_id=? AND quarter=?").bind(newQuarter, projectId, quarter),
    ]);
    return Response.json({ quarter: newQuarter });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json() as { projectId?: string; quarter?: string };
    const projectId = String(body.projectId ?? "");
    const quarter = String(body.quarter ?? "").toUpperCase();
    if (!projectId || !validQuarter(quarter)) return Response.json({ error: "季度格式不正確" }, { status: 400 });
    if (!(await canAccessProject(projectId, user.userId, true))) return Response.json({ error: "沒有編輯權限" }, { status: 403 });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM traffic_records WHERE project_id=? AND quarter=?").bind(projectId, quarter),
      env.DB.prepare("DELETE FROM surveys WHERE project_id=? AND quarter=?").bind(projectId, quarter),
    ]);
    return Response.json({ deleted: true });
  } catch (error) { return apiError(error); }
}
