import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const password = formData.get("password");
  const from = (formData.get("from") as string) || "/n8n-handbook/";

  if (!password || password !== process.env.N8N_HANDBOOK_PASSWORD) {
    const url = new URL("/n8n-handbook-login", req.url);
    url.searchParams.set("error", "1");
    url.searchParams.set("from", from);
    return NextResponse.redirect(url, { status: 303 });
  }

  const res = NextResponse.redirect(new URL(from, req.url), { status: 303 });
  res.cookies.set("n8n_handbook_auth", process.env.N8N_HANDBOOK_PASSWORD || "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 天
  });
  return res;
}
