import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { conversationReferenceSchema } from "@/modules/conversations/conversation.schemas";
import { providerReferenceSchema } from "@/modules/conversations/debt.schemas";
import { getConversationService } from "@/modules/conversations/server-dependencies";
import { conversationCookieName } from "@/shared/auth/session-token";
import { toErrorResponse } from "@/shared/errors/error-response";

type RouteContext = {
  params: Promise<{ conversationId: string; debtRef: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const publicReference = conversationReferenceSchema.parse(
      params.conversationId,
    );
    const debtRef = providerReferenceSchema.parse(params.debtRef);
    const token = (await cookies()).get(conversationCookieName)?.value;
    const debt = await getConversationService().getDebt(
      publicReference,
      token,
      debtRef,
      randomUUID(),
    );
    return NextResponse.json({ debt }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
