import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { organizationSlugSchema } from "@/modules/conversations/conversation.schemas";
import { getConversationService } from "@/modules/conversations/server-dependencies";
import {
  conversationCookieName,
  sessionCookieOptions,
} from "@/shared/auth/session-token";
import { getRuntimeEnv } from "@/shared/config/env";
import { toErrorResponse } from "@/shared/errors/error-response";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { slug: rawSlug } = await context.params;
    const slug = organizationSlugSchema.parse(rawSlug);
    const env = getRuntimeEnv();
    const result = await getConversationService().create(slug);
    const response = NextResponse.json(
      { conversation: result.conversation, requestId: randomUUID() },
      { status: 201 },
    );
    response.cookies.set(
      conversationCookieName,
      result.token,
      sessionCookieOptions(
        env.NODE_ENV === "production",
        env.SESSION_COOKIE_MAX_AGE_SECONDS,
      ),
    );
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
