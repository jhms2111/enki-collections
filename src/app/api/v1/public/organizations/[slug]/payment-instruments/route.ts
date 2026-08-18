import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { idempotencyHeaderSchema } from "@/modules/conversations/acceptance.schemas";
import { getPaymentPageService } from "@/modules/conversations/server-dependencies";
import { paymentPageInstrumentRequestSchema } from "@/modules/payments/payment-page.schemas";
import { organizationSlugSchema } from "@/modules/conversations/conversation.schemas";
import { conversationCookieName } from "@/shared/auth/session-token";
import { toErrorResponse } from "@/shared/errors/error-response";

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const body = paymentPageInstrumentRequestSchema.parse(await request.json());
    const { slug: rawSlug } = await context.params;
    const result = await getPaymentPageService().createInstrument({
      slug: organizationSlugSchema.parse(rawSlug),
      token: (await cookies()).get(conversationCookieName)?.value,
      type: body.type,
      idempotencyKey: idempotencyHeaderSchema.parse(request.headers.get("Idempotency-Key")),
      requestId: randomUUID(),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
