import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { projects, surveys } from "../../../../db/schema";
import { apiError, requireApiUser } from "../../_lib";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const body = await request.json() as { name?: string; code?: string; clientName?: string };
    const name = body.name?.trim();
    if (!name) return Response.json({ error: "計畫名稱不可空白" }, { status: 400 });
    const db = getDb();
    const owned = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), eq(projects.ownerUserId, user.userId))).limit(1);
    if (!owned.length) return Response.json({ error: "只有計畫擁有者可以修改名稱" }, { status: 403 });
    await db.update(projects).set({ name, code: body.code?.trim() ?? "", clientName: body.clientName?.trim() ?? "", updatedAt: new Date().toISOString() }).where(eq(projects.id, id));
    return Response.json({ project: { id, name, code: body.code?.trim() ?? "", clientName: body.clientName?.trim() ?? "", role: "owner" } });
  } catch (error) { return apiError(error); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const db = getDb();
    const owned = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), eq(projects.ownerUserId, user.userId))).limit(1);
    if (!owned.length) return Response.json({ error: "只有計畫擁有者可以刪除計畫" }, { status: 403 });
    const surveyRows = await db.select({ sourceObjectKeys: surveys.sourceObjectKeys }).from(surveys).where(eq(surveys.projectId, id));
    const objectKeys = surveyRows.flatMap(row => { try { return JSON.parse(row.sourceObjectKeys || "[]") as string[]; } catch { return []; } });
    if (objectKeys.length) await Promise.all(objectKeys.map(key => env.FILES.delete(key)));
    await db.delete(projects).where(eq(projects.id, id));
    return Response.json({ deleted: true });
  } catch (error) { return apiError(error); }
}
