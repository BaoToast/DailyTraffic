import { and, eq, or } from "drizzle-orm";
import { getChatGPTUser } from "../chatgpt-auth";
import { getDb } from "../../db";
import { projectMembers, projects, users } from "../../db/schema";

export async function requireApiUser() {
  const user = await getChatGPTUser();
  if (!user) throw new Response(JSON.stringify({ error: "請先登入" }), { status: 401, headers: { "content-type": "application/json" } });
  const db = getDb();
  await db.insert(users).values({ id: user.userId, email: user.email.toLowerCase(), displayName: user.displayName }).onConflictDoUpdate({ target: users.id, set: { email: user.email.toLowerCase(), displayName: user.displayName } });
  return user;
}

export async function canAccessProject(projectId: string, userId: string, write = false) {
  const db = getDb();
  const rows = await db.select({ owner: projects.ownerUserId, role: projectMembers.role })
    .from(projects)
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
    .where(and(eq(projects.id, projectId), or(eq(projects.ownerUserId, userId), eq(projectMembers.userId, userId))))
    .limit(1);
  const access = rows[0];
  return Boolean(access && (!write || access.owner === userId || access.role === "editor"));
}

export function apiError(error: unknown) {
  if (error instanceof Response) return error;
  const message = error instanceof Error ? error.message : "系統發生錯誤";
  return Response.json({ error: message }, { status: 500 });
}
