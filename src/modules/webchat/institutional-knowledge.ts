import type { BotTurn, CanonicalFact } from "./conversation-turn.types";
import { normalizeConversationalText } from "./normalize-conversational-text";

export const institutionalKnowledgeVersion = "enki-demo-institutional-v1";
export const institutionalIdentity = {
  name: "ENKI Atendimento de Cobrança Demonstrativo",
  nature: "Um ambiente fictício que apresenta como uma empresa de cobrança pode ajudar o consumidor a consultar informações fornecidas pelo credor, conhecer propostas autorizadas, registrar manifestações e acessar meios de pagamento emitidos por uma instituição financeira integrada.",
} as const;

export function guidedInstitutionalAnswer(action: string): Readonly<{ message: string; actions: readonly string[] }> | null {
  const key = normalizeConversationalText(action);
  if (key === "quem somos") return { message: "Somos uma plataforma de atendimento digital que facilita a comunicação entre credores e clientes.\n\nApresentamos informações fornecidas pelo credor, mostramos propostas previamente autorizadas e orientamos cada etapa da negociação. Não alteramos valores nem criamos condições por conta própria.\n\nNesta demonstração, todos os dados e instrumentos são fictícios e não possuem valor financeiro.", actions: ["Negociar dívida", "Voltar ao início"] };
  if (key === "como funciona") return { message: "Depois da identificação, o sistema consulta as cobranças demonstrativas disponíveis. Você escolhe uma dívida, revisa as propostas autorizadas e confirma conscientemente a opção desejada. A ENKI não cria valores, descontos ou parcelas.", actions: ["Consultar minhas dívidas", "Como funciona o pagamento", "Quem somos"] };
  if (key === "como funciona o pagamento" || key === "entender o pagamento" || key === "entender como funciona o pagamento") return { message: "Depois de confirmar uma proposta, você recebe acesso à página demonstrativa de pagamento. Nela é possível escolher Pix demo, boleto demo ou link demo. Nesta versão, nenhum instrumento possui valor financeiro e nenhum pagamento real é processado.", actions: ["Voltar para as propostas", "Quem somos", "Voltar ao início"] };
  if (key === "spc e serasa") return { message: "Nesta simulação, depois que um pagamento fosse oficialmente confirmado, a atualização da restrição seria encaminhada pelo credor. O prazo demonstrativo informado é de até cinco dias úteis após a confirmação aplicável. Este ambiente não consulta SPC ou Serasa e não confirma restrições reais.", actions: ["Como funciona o pagamento", "Consultar minhas dívidas", "Menu inicial"] };
  if (key === "seguranca") return { message: "Este ambiente utiliza somente dados fictícios. Em uma operação real, o cliente deve conferir o credor, a proposta e o endereço oficial antes de pagar. Senhas e códigos bancários nunca devem ser informados no atendimento.", actions: ["Quem somos", "Como funciona", "Consultar minhas dívidas"] };
  return null;
}

type Context = Readonly<{ identityVerified: boolean; facts: readonly CanonicalFact[]; lastSubject?: string }>;
type Answer = Readonly<{ subject: string; message: string; quickReplies?: readonly string[]; intent?: BotTurn["intent"] }>;

const generalUpdate = "A atualização somente pode começar depois que o pagamento aplicável ao acordo for efetivamente confirmado. Como informação geral, cabe ao credor solicitar a retirada da negativação no prazo aplicável após a quitação efetiva. O prazo normalmente informado para essa solicitação é de até cinco dias úteis. A condição exata pode depender do acordo, da confirmação bancária e da existência de outras restrições.\n\nNesta demonstração, não consultamos SPC ou Serasa e não confirmamos nenhuma restrição real.";

export function resolveInstitutionalQuestion(message: string, context: Context): Answer | null {
  const text = normalizeConversationalText(message);
  const facts = new Map(context.facts.map((fact) => [fact.key, fact.displayText]));
  if (/^(sim|e depois|quanto tempo|e isso)$/.test(text) && context.lastSubject?.startsWith("INSTITUTIONAL_")) {
    if (context.lastSubject === "INSTITUTIONAL_CREDIT_BUREAU") return { subject: context.lastSubject, message: generalUpdate };
    if (context.lastSubject === "INSTITUTIONAL_PAYMENT_CONFIRMATION") return { subject: context.lastSubject, message: "Primeiro, a instituição responsável precisa identificar e confirmar o pagamento. Informar o pagamento no chat não representa confirmação. Depois disso, o credor segue o procedimento de atualização aplicável." };
  }
  if (/quem (sao|e) voces|o que e (uma )?empresa de cobranca|o que voces fazem/.test(text)) return { subject: "INSTITUTIONAL_COLLECTION_COMPANY", message: "Uma empresa de cobrança atua no atendimento e na negociação de valores informados pelo credor. Ela apresenta as informações disponíveis, registra manifestações e oferece somente as condições previamente autorizadas. Ela não pode inventar dívidas, alterar valores ou confirmar pagamentos sem retorno oficial." };
  if (/por que (voces )?estao me cobrando|por que recebi (esse )?contato|de onde veio (essa )?divida/.test(text)) {
    if (!context.identityVerified || !facts.has("debt_creditor")) return { subject: "INSTITUTIONAL_CONTACT_REASON", message: "O contato pode ocorrer quando um credor encaminha uma pendência para atendimento. Para explicar uma situação específica, preciso primeiro localizar e validar seu atendimento pelo identificador." };
    return { subject: "INSTITUTIONAL_CONTACT_REASON", message: [facts.get("debt_creditor"), facts.get("debt_description"), facts.get("debt_amount"), facts.get("debt_due_date"), facts.get("debt_status")].filter(Boolean).join(" ") };
  }
  if (/credor.*empresa de cobranca|diferenca.*credor/.test(text)) return { subject: "INSTITUTIONAL_CREDITOR", message: "O credor é quem informa a pendência e autoriza as condições. A empresa de cobrança realiza o atendimento, apresenta essas informações e registra manifestações. Nesta demonstração, os dados são inteiramente fictícios." };
  if (/quando.*(nome|spc|serasa)|sai.*(spc|serasa)|e do spc|e do serasa/.test(text)) return { subject: "INSTITUTIONAL_CREDIT_BUREAU", message: generalUpdate };
  if (/paguei.*(quando|atualiza)|pagamento.*confirmad|compens/.test(text)) return { subject: "INSTITUTIONAL_PAYMENT_CONFIRMATION", message: "Primeiro é necessário que o pagamento seja identificado e confirmado pela instituição responsável. Informar o pagamento pelo chat não significa confirmação. Depois da confirmação, o credor realiza o procedimento de atualização conforme as condições aplicáveis." };
  if (/score|pontuacao/.test(text)) return { subject: "INSTITUTIONAL_SCORE", message: "Não. O assistente e a empresa de cobrança não controlam o score. A pontuação é calculada pelos serviços de proteção ao crédito conforme critérios próprios." };
  if (/golpe|seguranca|confiavel/.test(text)) return { subject: "INSTITUTIONAL_SECURITY", message: "Antes de pagar, confira o nome do credor, os dados da proposta e o endereço oficial da página. Nunca envie senha, código bancário ou dados completos de cartão pelo chat. Nesta demonstração, nenhum instrumento possui valor financeiro." };
  if (/nao reconheco|divida nao e minha/.test(text)) return { subject: "INSTITUTIONAL_DISPUTE", intent: context.identityVerified ? "DISPUTE_DEBT" : "HELP", message: context.identityVerified ? "Entendo. Você pode registrar uma contestação para análise. Isso não significa que a dívida foi considerada válida ou inválida, e nenhuma decisão será tomada automaticamente." : "Entendo. Para consultar a situação e registrar uma contestação, primeiro preciso localizar e validar seu atendimento. Isso não significa que a dívida foi considerada válida ou inválida." };
  if (/acordo vencido|parcela atrasou|parcela atrasada|cancelamento de proposta|cancelar proposta/.test(text)) return { subject: "INSTITUTIONAL_EXPIRED_AGREEMENT", message: "Uma proposta vencida ou indisponível não pode ser aceita. Em caso de parcela atrasada, somente as condições atualmente autorizadas podem ser apresentadas; o assistente não recalcula nem altera o acordo." };
  if (/pix|boleto|avista|a vista|parcelad|entrada|parcelas?/.test(text)) return { subject: "INSTITUTIONAL_PAYMENT_METHODS", message: "As formas disponíveis dependem das propostas previamente autorizadas pelo credor. Uma proposta pode ser à vista ou parcelada, com entrada, parcelas e vencimentos informados pelo sistema. Pix e boleto desta demonstração são somente textos não pagáveis." };
  if (/comprovante/.test(text)) return { subject: "INSTITUTIONAL_RECEIPT", message: "Um comprovante pode ajudar na análise, mas não confirma sozinho a liquidação. Nesta demonstração não recebemos arquivos; o pagamento somente poderia ser confirmado por retorno oficial da instituição responsável." };
  if (/promessa|nao consigo pagar agora/.test(text)) return { subject: "INSTITUTIONAL_PROMISE", message: "Uma promessa registra a intenção de pagar em uma data informada. Ela não representa pagamento, quitação ou reserva automática de uma proposta." };
  if (/protecao de dados|privacidade|meus dados/.test(text)) return { subject: "INSTITUTIONAL_PRIVACY", message: "Use apenas o identificador fictício da demonstração. Não envie senhas, códigos bancários, cartão ou documentos pessoais pelo chat. As informações específicas só aparecem após a validação do atendimento." };
  if (/falar com (uma )?pessoa|atendimento humano|atendente/.test(text)) return { subject: "INSTITUTIONAL_HUMAN", message: "O atendimento humano ainda não está integrado nesta demonstração. O assistente não fingirá uma transferência. Você pode continuar consultando informações ou encerrar a conversa." };
  if (/parar.*mensagens|interromper.*mensagens/.test(text)) return { subject: "INSTITUTIONAL_OPT_OUT", intent: "OPT_OUT", message: "Posso interromper as mensagens desta conversa. A interrupção exige uma confirmação explícita." };
  if (/encerrar.*(conversa|atendimento)/.test(text)) return { subject: "INSTITUTIONAL_CLOSE", intent: "CLOSE", message: "Posso encerrar esta conversa. O encerramento exige uma confirmação explícita." };
  if (/proposta|desconto/.test(text)) return { subject: "INSTITUTIONAL_OFFERS", message: "As propostas são fornecidas previamente pelo credor. O assistente pode apresentá-las e explicá-las, mas não cria descontos, não recalcula valores e não altera condições." };
  if (/origem.*informac|dados.*vieram/.test(text)) return { subject: "INSTITUTIONAL_DATA_SOURCE", message: "As informações de cobrança são fornecidas pelo credor e consultadas pelo sistema autorizado. Nesta demonstração, todos os registros são fictícios e configurados no ambiente sandbox." };
  if (/quanto tempo|confirmacao ou vencimento|vencimento ou confirmacao/.test(text)) return { subject: "INSTITUTIONAL_AMBIGUOUS_TIME", message: "Você quis saber sobre o vencimento da proposta ou sobre o prazo de confirmação do pagamento?", quickReplies: ["Vencimento da proposta", "Confirmação do pagamento"] };
  return null;
}
