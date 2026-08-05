import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { toErrorResponse } from "@/shared/errors/error-response";

export function toSandboxErrorResponse(error: unknown) {
  if (!(error instanceof ZodError)) return withPrivateNoStore(toErrorResponse(error));
  return NextResponse.json({
    error: { code: "INVALID_INPUT", message: "Revise os campos indicados." },
    fieldErrors: error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })),
  }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
}

export function withPrivateNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
