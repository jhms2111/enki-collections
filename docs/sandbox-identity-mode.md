# Modo de identificação do sandbox

`DEMO_IDENTIFIER_ONLY` é um modo exclusivo da demonstração. Ele só é ativado para slugs listados explicitamente em `DEMO_IDENTIFIER_ONLY_ORGANIZATIONS` e somente quando o perfil, desafio, opções, devedores, credores, dívidas e propostas relacionados possuem `isDemo=true`.

O identificador continua limitado ao formato `DEMO-*`; conversa, cookie HttpOnly e isolamento por organização continuam obrigatórios. O servidor conclui a identidade sem enviar o desafio ou qualquer `optionRef` ao navegador.

Esse modo não deve ser configurado para organizações com dados reais. Uma integração real deverá usar o método de autenticação e os fatores de validação definidos e aprovados pelo cliente antes de revelar qualquer cobrança.
