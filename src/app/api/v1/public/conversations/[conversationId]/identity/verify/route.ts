import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  conversationReferenceSchema,
  identityVerificationSchema,
} from "@/modules/conversations/conversation.schemas";
import { getConversationService } from "@/modules/conversations/server-dependencies";
import { conversationCookieName } from "@/shared/auth/session-token";
import { toErrorResponse } from "@/shared/errors/error-response";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId: rawReference } = await context.params;
    const publicReference = conversationReferenceSchema.parse(rawReference);
    const body = identityVerificationSchema.parse(await request.json());
    const token = (await cookies()).get(conversationCookieName)?.value;
    const result = await getConversationService().verifyIdentity(
      publicReference,
      token,
      body.optionRef,
      randomUUID(),
    );
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
