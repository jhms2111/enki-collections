# Bloco 10A — núcleo do sandbox configurável

O Bloco 10A substitui as fixtures estáticas por um `SandboxDebtProvider`
persistido e configurável, mantendo intacto o contrato `DebtProvider`.

## Escopo entregue

- autenticação interna separada, limitada à organização `jf-demo`;
- sessão interna com token forte e somente hash persistido;
- assistente único em `/internal` para criar um cenário completo;
- lista resumida, visualização, edição versionada, ativação e desativação;
- link para testar o cenário em `/demo/jf-demo`;
- auditoria interna persistida e sanitizada;
- seed idempotente equivalente às fixtures de `jf-demo` e `atlas-demo`;
- isolamento por `organizationId` em tabelas, serviço e provider;
- instrumentos exclusivamente textuais e não pagáveis.

Não há importação, upload, exportação, JSON livre, múltiplos usuários, seleção de
organização, painel analítico, IA, WhatsApp ou integração JF Solutions.

## Variáveis locais adicionais

Configurar sem versionar valores:

- `INTERNAL_ACCESS_CODE_HASH`;
- `INTERNAL_ACCESS_HMAC_SECRET`, independente e com pelo menos 48 bytes;
- `INTERNAL_SESSION_MAX_AGE_SECONDS`;
- `INTERNAL_ACCESS_MAX_ATTEMPTS`;
- `INTERNAL_ACCESS_WINDOW_SECONDS`.

O hash usa HMAC-SHA-256 com o domínio `internal-access-code:v1`.

## Migração controlada

A migração `20260804000100_block10a_sandbox_core` foi criada, mas não deve ser
aplicada à conexão Supabase sem autorização específica. Migração local isolada e
migração de produção são decisões separadas. O seed só deve ser executado depois
da migração no ambiente correspondente e deve ser executado duas vezes para
confirmar idempotência.

Antes de qualquer deploy:

1. aplicar a migração no ambiente autorizado;
2. executar o seed duas vezes;
3. repetir testes de equivalência e isolamento;
4. configurar os segredos internos sem exibi-los;
5. validar manualmente `/internal` e o fluxo público;
6. obter aprovação separada para produção e deploy.
