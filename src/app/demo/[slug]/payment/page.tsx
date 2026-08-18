import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import { getPaymentPageService } from "@/modules/conversations/server-dependencies";
import { PaymentPage } from "@/modules/payments/payment-page";
import { conversationCookieName } from "@/shared/auth/session-token";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DemoPaymentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let context;
  try {
    context = await getPaymentPageService().getContext({
      slug,
      token: (await cookies()).get(conversationCookieName)?.value,
      requestId: randomUUID(),
    });
  } catch {
    return <main className="payment-page"><section className="payment-shell payment-empty"><p className="demo-stamp">DEMONSTRAÇÃO — SEM VALOR FINANCEIRO</p><h1>Página de pagamento indisponível</h1><p>Confirme uma proposta na conversa antes de escolher uma forma demonstrativa de pagamento.</p><a className="primary-action" href={`/demo/${encodeURIComponent(slug)}/chat`}>Voltar à conversa</a></section></main>;
  }
  return <PaymentPage slug={slug} context={context} />;
}
