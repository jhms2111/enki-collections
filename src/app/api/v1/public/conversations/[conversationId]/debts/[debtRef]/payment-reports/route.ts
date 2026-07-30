import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { idempotencyHeaderSchema } from "@/modules/conversations/acceptance.schemas";
import { conversationReferenceSchema } from "@/modules/conversations/conversation.schemas";
import { providerReferenceSchema } from "@/modules/conversations/debt.schemas";
import { paymentReportSchema } from "@/modules/conversations/occurrence.schemas";
import { getOccurrenceService } from "@/modules/conversations/server-dependencies";
import { conversationCookieName } from "@/shared/auth/session-token";
import { toErrorResponse } from "@/shared/errors/error-response";

type RouteContext = {
  params: Promise<{ conversationId: string; debtRef: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const result = await getOccurrenceService().reportPayment({
      publicReference: conversationReferenceSchema.parse(params.conversationId),
      debtRef: providerReferenceSchema.parse(params.debtRef),
      token: (await cookies()).get(conversationCookieName)?.value,
      idempotencyKey: idempotencyHeaderSchema.parse(
        request.headers.get("Idempotency-Key"),
      ),
      request: paymentReportSchema.parse(await request.json()),
      requestId: randomUUID(),
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
