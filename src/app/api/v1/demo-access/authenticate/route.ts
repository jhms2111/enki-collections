import { NextResponse } from "next/server";
import { z } from "zod";

import {
  decodeDemoAccessState,
  demoAccessCookieName,
  demoAccessCookieOptions,
  encodeDemoAccessState,
  getDemoAccessEnv,
  verifyDemoAccessCode,
} from "@/shared/auth/demo-access";

const requestSchema = z
  .object({
    code: z.string().min(8).max(128),
    returnTo: z.string().max(200).default("/demo/jf-demo"),
  })
  .strict();

function safeReturnTo(value: string): string {
  return /^\/demo\/[a-z0-9-]+(?:\/.*)?$/.test(value)
    ? value
    : "/demo/jf-demo";
}

export async function POST(request: Request) {
  const now = new Date();
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
      { status: 503 },
    );
  }

  let body;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "O código informado é inválido.",
        },
      },
      { status: 400 },
    );
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const rawCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${demoAccessCookieName}=`))
    ?.slice(demoAccessCookieName.length + 1);
  const existing = decodeDemoAccessState(
    rawCookie,
    env.DEMO_ACCESS_HMAC_SECRET,
    now,
  );
  const windowMilliseconds = env.DEMO_ACCESS_WINDOW_SECONDS * 1_000;
  const currentWindow =
    existing &&
    !existing.authorized &&
    now.getTime() - existing.windowStartedAt < windowMilliseconds
      ? existing
      : {
          authorized: false,
          failedAttempts: 0,
          windowStartedAt: now.getTime(),
          expiresAt: now.getTime() + windowMilliseconds,
        };

  if (currentWindow.failedAttempts >= env.DEMO_ACCESS_MAX_ATTEMPTS) {
    return limitedResponse(currentWindow, env, now);
  }

  if (
    !verifyDemoAccessCode(
      body.code,
      env.DEMO_ACCESS_CODE_HASH,
      env.DEMO_ACCESS_HMAC_SECRET,
    )
  ) {
    const failedState = {
      ...currentWindow,
      failedAttempts: currentWindow.failedAttempts + 1,
    };
    if (failedState.failedAttempts >= env.DEMO_ACCESS_MAX_ATTEMPTS) {
      return limitedResponse(failedState, env, now);
    }
    const response = NextResponse.json(
      {
        error: {
          code: "DEMO_ACCESS_DENIED",
          message: "Código de acesso inválido.",
          attemptsRemaining:
            env.DEMO_ACCESS_MAX_ATTEMPTS - failedState.failedAttempts,
        },
      },
      { status: 401 },
    );
    setAccessCookie(response, failedState, env);
    return response;
  }

  const authorizedState = {
    authorized: true,
    failedAttempts: 0,
    windowStartedAt: now.getTime(),
    expiresAt:
      now.getTime() + env.DEMO_ACCESS_COOKIE_MAX_AGE_SECONDS * 1_000,
  };
  const response = NextResponse.json({
    redirectTo: safeReturnTo(body.returnTo),
  });
  setAccessCookie(response, authorizedState, env);
  return response;
}

function limitedResponse(
  state: {
    authorized: boolean;
    failedAttempts: number;
    windowStartedAt: number;
    expiresAt: number;
  },
  env: ReturnType<typeof getDemoAccessEnv>,
  now: Date,
) {
  const retryAfter = Math.max(
    Math.ceil((state.expiresAt - now.getTime()) / 1_000),
    1,
  );
  const response = NextResponse.json(
    {
      error: {
        code: "DEMO_ACCESS_RATE_LIMITED",
        message: "Muitas tentativas. Aguarde antes de tentar novamente.",
        retryAfter,
      },
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    },
  );
  setAccessCookie(response, state, env);
  return response;
}

function setAccessCookie(
  response: NextResponse,
  state: Parameters<typeof encodeDemoAccessState>[0],
  env: ReturnType<typeof getDemoAccessEnv>,
) {
  const maxAge = Math.max(
    Math.ceil((state.expiresAt - Date.now()) / 1_000),
    1,
  );
  response.cookies.set(
    demoAccessCookieName,
    encodeDemoAccessState(state, env.DEMO_ACCESS_HMAC_SECRET),
    demoAccessCookieOptions(
      process.env.VERCEL_ENV === "production" ||
        process.env.NODE_ENV === "production",
      maxAge,
    ),
  );
}
