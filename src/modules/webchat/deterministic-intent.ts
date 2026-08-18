import type { ConversationalIntent } from "./conversation-turn.types";
import { normalizeConversationalText, requestsExplanation } from "./normalize-conversational-text";

export type SafeChatIntent = ConversationalIntent;

export function interpretSafeChatText(value: string): SafeChatIntent {
  const normalized = normalizeConversationalText(value);
  if (/\b(parar|interromper|cancelar)\b.{0,24}\b(mensagem|mensagens|contato|comunicacao)\b/.test(normalized)) return "OPT_OUT";
  if (/\b(encerrar|finalizar|terminar)\b.{0,24}\b(atendimento|conversa|chat)\b/.test(normalized)) return "CLOSE";
  if (/\b(ja\s+pag(?:uei|o)|pagamento\s+(?:feito|realizado)|informar\s+pagamento)\b/.test(normalized)) return "REPORT_PAYMENT";
  if (/\b(nao\s+reconheco|contestar|contestacao|valor\s+incorreto)\b/.test(normalized)) return "DISPUTE_DEBT";
  if (/\b(promessa|promet(?:er|o)|vou\s+pagar|pretendo\s+pagar)\b/.test(normalized)) return "MAKE_PAYMENT_PROMISE";
  if (/\b(aceitar|aceito|aceite|solicitar\s+(?:o\s+)?aceite|quero\s+aceitar|confirmar\s+(?:a\s+)?proposta|fechar\s+(?:o\s+)?acordo)\b/.test(normalized)) return "ACCEPT_OFFER";
  if (/\b(pagamento|pagar|onde pago|como pago|como realizar o pagamento|pagina de pagamento|pix|boleto|instrumento|link de pagamento|gerar link|manda o link|quero pagar|como seria esse pagamento)\b/.test(normalized)) return "REQUEST_INSTRUMENT";
  if (requestsExplanation(normalized) || /\b(valor(?:\s+e\s+vencimento)?|quando\s+vence|vencimento|parcelas?|continue|como\s+faco\s+isso|sim)\b/.test(normalized)) return "HELP";
  if (/\b(ajuda|menu|opcoes)\b/.test(normalized)) return "HELP";
  if (/\b(divida|dividas|credor|credores)\b/.test(normalized)) return "LIST_DEBTS";
  if (/\b(proposta|propostas|acordo|acordos|parcelar|parcelado|a\s+vista|formas?\s+de\s+pagamento)\b/.test(normalized)) return "LIST_OFFERS";
  return "UNKNOWN";
}
