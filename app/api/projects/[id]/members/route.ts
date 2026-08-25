import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { projectMembers, projects, users } from "../../../../../db/schema";
import { apiError, requireApiUser } from "../../../_lib";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const db = getDb();
    const owned = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), eq(projects.ownerUserId, user.userId))).limit(1);
    if (!owned.length) return Response.json({ error: "只有計畫擁有者可以分享" }, { status: 403 });
    const body = await request.json() as { email?: string; role?: "viewer" | "editor" };
    const email = body.email?.trim().toLowerCase();
    if (!email) return Response.json({ error: "請輸入同事信箱" }, { status: 400 });
    const target = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!target.length) return Response.json({ error: "該同事需先登入網站一次，才能加入計畫" }, { status: 404 });
    await db.insert(projectMembers).values({ projectId: id, userId: target[0].id, role: body.role === "editor" ? "editor" : "viewer", grantedBy: user.userId }).onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: body.role === "editor" ? "editor" : "viewer", grantedBy: user.userId } });
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
