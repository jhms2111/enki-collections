# Bloco 9 — deploy gratuito do protótipo pessoal

Este procedimento prepara Vercel Hobby e o projeto Supabase Free já existente.
Não contrata planos, add-ons, domínios ou serviços externos. O protótipo usa
somente fixtures fictícias e não possui compromisso de disponibilidade.

## Limites assumidos

- Vercel Hobby, exclusivamente como protótipo pessoal.
- Supabase Free existente, sujeito a pausa por inatividade.
- Domínio padrão `vercel.app`.
- Custo obrigatório: US$ 0.
- Reavaliação obrigatória antes de piloto real, uso comercial ou contrato.

## Variáveis da Vercel

Configurar somente em Production, sem prefixo `NEXT_PUBLIC_`:

- `DATABASE_URL`
- `CONVERSATION_SESSION_SECRET`
- `IDEMPOTENCY_HMAC_SECRET`
- `DEMO_ACCESS_CODE_HASH`
- `DEMO_ACCESS_HMAC_SECRET`
- `DEMO_ACCESS_MAX_ATTEMPTS`
- `DEMO_ACCESS_WINDOW_SECONDS`
- `DEMO_ACCESS_COOKIE_MAX_AGE_SECONDS`
- `DEMO_VERSION`
- `APP_URL` após conhecer a URL definitiva

Não configurar `NODE_ENV`; a Vercel controla esse valor.

Não configurar `DIRECT_URL` na Vercel. O `prisma.config.ts` usa uma URL
deliberadamente inválida apenas durante `prisma generate` quando `DIRECT_URL`
não está presente. Migrações exigem `DIRECT_URL` real no ambiente local
controlado.

Os dois segredos HMAC e o segredo de sessão devem ser independentes, aleatórios
e ter pelo menos 48 bytes. O código e seu hash nunca entram no Git, logs, URL ou
bundle. O hash é calculado localmente com `hashDemoAccessCode`.

## Migração e seed

Antes do primeiro deploy:

1. carregar `DIRECT_URL` somente no `.env` local ignorado;
2. executar `npm run prisma:validate`;
3. executar `npm exec -- prisma migrate status`;
4. executar `npm run db:migrate` somente se houver migrações pendentes;
5. executar `npm run db:seed` duas vezes;
6. executar `node scripts/check-database-foundation.mjs`;
7. confirmar que não há dados pessoais ou financeiros reais.

Migrações não fazem parte do build da Vercel.

## Única regra gratuita do WAF

Na Fase 2, criar no máximo uma regra de rate limiting:

- condição: caminho começa com `/api/v1/`;
- chave: IP;
- limite inicial: 60 requisições em 10 minutos;
- ação: rate limit;
- revisar que o painel não habilitou cobrança ou add-on;
- cancelar a configuração se houver qualquer solicitação de pagamento.

O cookie assinado limita o código a cinco falhas por janela no navegador. Ele
não substitui o WAF, porque cookies podem ser removidos. A regra por IP é a
camada definitiva contra repetição automatizada dentro dos recursos gratuitos.

## Deploy

1. importar o repositório na Vercel sem iniciar upgrade;
2. confirmar framework Next.js e Node.js 24;
3. inserir variáveis manualmente;
4. deixar `APP_URL` ausente no primeiro preview;
5. gerar preview;
6. executar smoke test;
7. confirmar a URL final `https://<projeto>.vercel.app`;
8. preencher `APP_URL` com essa origem exata;
9. gerar novo deployment;
10. somente então promover para Production.

Preview não deve receber variáveis do banco de produção automaticamente.

## Smoke test

1. `GET /api/health` responde 200 sem exigir código.
2. `/robots.txt` contém `Disallow: /`.
3. `/demo/jf-demo` redireciona para `/demo-access`.
4. APIs protegidas sem cookie retornam 401.
5. mutação sem `Origin` ou com origem divergente retorna 403.
6. código incorreto reduz tentativas sem aparecer em logs.
7. quinta falha retorna 429 e `Retry-After`.
8. código correto cria cookie HttpOnly, Secure e SameSite=Lax.
9. o fluxo fictício completo funciona após autenticação.
10. desafio público não contém resposta correta ou referência interna.
11. instrumento permanece textual e não pagável.
12. respostas de demo e API contêm `Cache-Control: no-store`.
13. respostas contêm `X-Robots-Tag`, CSP, `nosniff` e proteção contra frame.
14. HTML, JavaScript e logs não contêm segredos ou URLs do Supabase.
15. confirmar 360 px, desktop e teclado.

## Logs mínimos

Permitir apenas nome seguro do erro, status, rota normalizada, duração,
`requestId` e versão. Nunca registrar:

- código de acesso ou hash;
- cookies e tokens;
- idempotency key;
- identificadores e desafios;
- payloads;
- descrições de contestação;
- instrumentos;
- URLs ou credenciais do banco.

Usar apenas logs e métricas incluídos na Vercel e no Supabase Free.

## Rollback

Aplicação:

1. abrir Deployments na Vercel;
2. selecionar o último deployment saudável;
3. promover esse deployment novamente;
4. repetir health check e smoke test;
5. não executar rollback destrutivo de banco.

Configuração:

1. reverter a variável ou regra alterada;
2. gerar novo deployment se necessário;
3. rotacionar segredos suspeitos;
4. nunca publicar valores antigos em tickets ou logs.

Banco:

- não há migração nova neste bloco;
- seed é idempotente e não apaga registros;
- qualquer restauração exige aprovação separada.

## Critério de interrupção

Interromper antes do deploy se a Vercel ou o Supabase solicitar cartão,
upgrade, add-on, excedente pago ou alteração de plano. Antes de piloto real ou
contrato, reavaliar custos, disponibilidade, backups, proteção e termos de uso.

## Publicação da Fase 2

- Data da publicação: 4 de agosto de 2026.
- Ambiente: Vercel Hobby, Production.
- URL pública: `https://enki-collections.vercel.app`.
- Deployment validado: `dpl_DSubRXRKESfnKY9UJjAhSjX1Ad6h`.
- Supabase: projeto Free existente, sem alteração de plano.
- WAF: uma regra por IP para `/api/v1/*`, com 60 requisições em 10 minutos.
- Custo obrigatório confirmado durante a publicação: US$ 0.
- Smoke tests HTTP e fluxo autenticado completo: aprovados.

O deployment usa exclusivamente fixtures fictícias e instrumentos demonstrativos
sem valor financeiro. A publicação não estabelece disponibilidade, piloto real ou
uso contratual. Nenhum segredo, hash, URL de banco ou código de acesso é registrado
neste documento.
