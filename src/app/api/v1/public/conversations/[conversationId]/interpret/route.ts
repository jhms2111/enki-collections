import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { conversationReferenceSchema } from "@/modules/conversations/conversation.schemas";
import { getConversationTurnService } from "@/modules/conversations/server-dependencies";
import { conversationTurnRequestSchema } from "@/modules/webchat/conversation-turn.schemas";
import { conversationCookieName } from "@/shared/auth/session-token";
import { toErrorResponse } from "@/shared/errors/error-response";

type RouteContext = { params: Promise<{ conversationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const body = conversationTurnRequestSchema.parse(await request.json());
    const turn = await getConversationTurnService().interpret({
      publicReference: conversationReferenceSchema.parse(conversationId),
      token: (await cookies()).get(conversationCookieName)?.value,
      ...body,
    });
    return NextResponse.json({ turn }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
