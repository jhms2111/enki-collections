import { NextRequest, NextResponse } from "next/server";

import {
  decodeDemoAccessState,
  demoAccessCookieName,
  getDemoAccessEnv,
} from "@/shared/auth/demo-access";

const accessPage = "/demo-access";
const accessApi = "/api/v1/demo-access/authenticate";
const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function securityFailure(code: string, status: number) {
  return NextResponse.json(
    { error: { code, message: "Solicitação não autorizada." } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function validateMutationOrigin(request: NextRequest): NextResponse | null {
  if (!mutationMethods.has(request.method)) return null;
  const origin = request.headers.get("origin");
  const configured = process.env.APP_URL;
  const expected = configured ? new URL(configured) : request.nextUrl;
  const host = request.headers.get("host");
  if (!origin || origin !== expected.origin || host !== expected.host) {
    return securityFailure("INVALID_REQUEST_ORIGIN", 403);
  }
  return null;
}

export async function proxy(request: NextRequest) {
  const originFailure = validateMutationOrigin(request);
  if (originFailure) return originFailure;

  const pathname = request.nextUrl.pathname;
  if (pathname === accessPage || pathname === accessApi) {
    return NextResponse.next();
  }

  let env;
  try {
    env = getDemoAccessEnv();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "DEMO_UNAVAILABLE",
          message: "A demonstração está temporariamente indisponível.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const state = decodeDemoAccessState(
    request.cookies.get(demoAccessCookieName)?.value,
    env.DEMO_ACCESS_HMAC_SECRET,
    new Date(),
  );
  if (state?.authorized) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return securityFailure("DEMO_ACCESS_REQUIRED", 401);
  }
  const target = new URL(accessPage, request.url);
  target.searchParams.set("returnTo", pathname);
  return NextResponse.redirect(target);
}

export const config = {
  matcher: ["/demo/:path*", "/api/v1/:path*"],
};
