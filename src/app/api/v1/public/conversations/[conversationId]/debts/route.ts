import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { conversationReferenceSchema } from "@/modules/conversations/conversation.schemas";
import { getConversationService } from "@/modules/conversations/server-dependencies";
import { conversationCookieName } from "@/shared/auth/session-token";
import { toErrorResponse } from "@/shared/errors/error-response";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { conversationId: rawReference } = await context.params;
    const publicReference = conversationReferenceSchema.parse(rawReference);
    const token = (await cookies()).get(conversationCookieName)?.value;
    const debts = await getConversationService().listDebts(
      publicReference,
      token,
      randomUUID(),
    );
    return NextResponse.json(debts, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
