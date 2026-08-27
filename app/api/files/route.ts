import { env } from "cloudflare:workers";
import { apiError, canAccessProject, requireApiUser } from "../_lib";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const form = await request.formData();
    const projectId = String(form.get("projectId") ?? "");
    const quarter = String(form.get("quarter") ?? "");
    const file = form.get("file");
    if (!(file instanceof File) || !projectId || !/^(?:\d{3}|\d{4})Q[1-4]$/.test(quarter)) return Response.json({ error: "上傳資料不完整" }, { status: 400 });
    if (!(await canAccessProject(projectId, user.userId, true))) return Response.json({ error: "沒有編輯權限" }, { status: 403 });
    const safeName = file.name.replace(/[^\w.()~\-\u4e00-\u9fff]/g, "_");
    const key = `${projectId}/${quarter}/${crypto.randomUUID()}-${safeName}`;
    await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/vnd.ms-excel" }, customMetadata: { uploadedBy: user.userId, originalName: file.name } });
    return Response.json({ key });
  } catch (error) { return apiError(error); }
}
