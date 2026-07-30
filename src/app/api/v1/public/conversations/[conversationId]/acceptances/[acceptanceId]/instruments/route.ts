import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  acceptanceReferenceSchema,
  idempotencyHeaderSchema,
  paymentInstrumentSchema,
} from "@/modules/conversations/acceptance.schemas";
import { conversationReferenceSchema } from "@/modules/conversations/conversation.schemas";
import { getOfferAcceptanceService } from "@/modules/conversations/server-dependencies";
import { conversationCookieName } from "@/shared/auth/session-token";
import { toErrorResponse } from "@/shared/errors/error-response";

type RouteContext = {
  params: Promise<{
    conversationId: string;
    acceptanceId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const body = paymentInstrumentSchema.parse(await request.json());
    const result = await getOfferAcceptanceService().createInstrument({
      publicReference: conversationReferenceSchema.parse(
        params.conversationId,
      ),
      token: (await cookies()).get(conversationCookieName)?.value,
      acceptanceReference: acceptanceReferenceSchema.parse(
        params.acceptanceId,
      ),
      type: body.type,
      idempotencyKey: idempotencyHeaderSchema.parse(
        request.headers.get("Idempotency-Key"),
      ),
      requestId: randomUUID(),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
