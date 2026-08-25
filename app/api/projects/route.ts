import { eq, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { projectMembers, projects } from "../../../db/schema";
import { apiError, requireApiUser } from "../_lib";

export async function GET() {
  try {
    const user = await requireApiUser();
    const db = getDb();
    const rows = await db.select({ id: projects.id, name: projects.name, code: projects.code, clientName: projects.clientName, description: projects.description, ownerUserId: projects.ownerUserId, role: projectMembers.role, updatedAt: projects.updatedAt })
      .from(projects)
      .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
      .where(or(eq(projects.ownerUserId, user.userId), eq(projectMembers.userId, user.userId)));
    const unique = Array.from(new Map(rows.map(row => [row.id, { ...row, role: row.ownerUserId === user.userId ? "owner" : row.role }])).values());
    return Response.json({ projects: unique });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json() as { name?: string; code?: string; clientName?: string; description?: string };
    const name = body.name?.trim();
    if (!name) return Response.json({ error: "請輸入計畫名稱" }, { status: 400 });
    const row = { id: crypto.randomUUID(), ownerUserId: user.userId, name, code: body.code?.trim() ?? "", clientName: body.clientName?.trim() ?? "", description: body.description?.trim() ?? "" };
    await getDb().insert(projects).values(row);
    return Response.json({ project: { ...row, role: "owner" } }, { status: 201 });
  } catch (error) { return apiError(error); }
}
