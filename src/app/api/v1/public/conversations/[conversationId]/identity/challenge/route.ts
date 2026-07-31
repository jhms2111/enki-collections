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
    const { conversationId } = await context.params;
    const result = await getConversationService().getPublicIdentityChallenge(
      conversationReferenceSchema.parse(conversationId),
      (await cookies()).get(conversationCookieName)?.value,
      randomUUID(),
    );
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
