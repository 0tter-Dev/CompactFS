# AGENTS.md

## Antes de mudar algo

Leia o `README.md`. Ele é a única fonte de verdade sobre escopo, regras do produto e stack. Este projeto mantém o mínimo de documentação possível: a evolução é guiada pelo uso real, pelos testes automatizados e pelos testes manuais do mantenedor.

## Regras

- Prefira mudanças pequenas, explícitas e fáceis de testar.
- Leveza e velocidade são prioridade: não adicione dependência nova sem avisar o mantenedor e dizer o impacto no tamanho e no tempo de inicialização.
- Não grave nada no disco do usuário (arquivos, pastas, cache) sem ação explícita dele ou configuração. O padrão é guardar dados auxiliares no dispositivo.
- Operações destrutivas (excluir, sobrescrever) exigem teste automatizado e confirmação clara na interface. Salvamento sempre atômico (temporário + substituição).
- Código novo vem com teste quando for viável; diga ao mantenedor o que ele precisa validar manualmente.
- Atualize o `README.md` (Quick Start, Current Scope, Regras do Produto, Status, Stack) quando a mudança alterar o que o projeto roda, oferece ou usa. Não crie documentos novos sem pedido.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:` etc.).
- Não mude o escopo, as regras do produto ou as plataformas do README sem aprovação explícita.
