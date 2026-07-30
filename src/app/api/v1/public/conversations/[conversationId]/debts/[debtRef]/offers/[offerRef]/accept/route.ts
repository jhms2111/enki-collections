import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  idempotencyHeaderSchema,
  offerAcceptanceSchema,
} from "@/modules/conversations/acceptance.schemas";
import { conversationReferenceSchema } from "@/modules/conversations/conversation.schemas";
import { providerReferenceSchema } from "@/modules/conversations/debt.schemas";
import { getOfferAcceptanceService } from "@/modules/conversations/server-dependencies";
import { conversationCookieName } from "@/shared/auth/session-token";
import { toErrorResponse } from "@/shared/errors/error-response";

type RouteContext = {
  params: Promise<{
    conversationId: string;
    debtRef: string;
    offerRef: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const result = await getOfferAcceptanceService().acceptOffer({
      publicReference: conversationReferenceSchema.parse(
        params.conversationId,
      ),
      token: (await cookies()).get(conversationCookieName)?.value,
      debtRef: providerReferenceSchema.parse(params.debtRef),
      offerRef: providerReferenceSchema.parse(params.offerRef),
      idempotencyKey: idempotencyHeaderSchema.parse(
        request.headers.get("Idempotency-Key"),
      ),
      request: offerAcceptanceSchema.parse(await request.json()),
      requestId: randomUUID(),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
