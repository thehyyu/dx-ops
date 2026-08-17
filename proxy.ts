import { NextRequest, NextResponse } from "next/server";

export default function proxy(req: NextRequest) {
  // protect /n8n-handbook — simple shared-password gate
  const token = req.cookies.get("n8n_handbook_auth")?.value;
  if (!token || token !== process.env.N8N_HANDBOOK_PASSWORD) {
    const loginUrl = new URL("/n8n-handbook-login", req.url);
    loginUrl.searchParams.set("from", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/n8n-handbook", "/n8n-handbook/:path*"],
};
