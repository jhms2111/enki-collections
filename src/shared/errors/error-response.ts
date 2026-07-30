import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { ApplicationError } from "./application-error";

export function toErrorResponse(error: unknown) {
  const requestId = randomUUID();

  if (error instanceof ApplicationError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "A entrada informada é inválida.",
          requestId,
        },
      },
      { status: 400 },
    );
  }

  console.error({
    requestId,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Não foi possível concluir a solicitação.",
        requestId,
      },
    },
    { status: 500 },
  );
}
