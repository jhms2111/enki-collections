import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  conversationReferenceSchema,
  terminalConversationCommandSchema,
} from "@/modules/conversations/conversation.schemas";
import { getConversationService } from "@/modules/conversations/server-dependencies";
import { conversationCookieName } from "@/shared/auth/session-token";
import { toErrorResponse } from "@/shared/errors/error-response";

type RouteContext = { params: Promise<{ conversationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const publicReference = conversationReferenceSchema.parse(conversationId);
    terminalConversationCommandSchema.parse(await request.json());
    const token = (await cookies()).get(conversationCookieName)?.value;
    const conversation = await getConversationService().close(publicReference, token);
    return NextResponse.json({ conversation }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
