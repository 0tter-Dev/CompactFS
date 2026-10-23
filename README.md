# CompactFS (working title)

App leve e rápido para visualizar (e, em fases posteriores, editar) arquivos em discos portáteis, como HDs e SSDs externos, voltado a público geral. "CompactFS" (CFS) é só um nome provisório, não o nome final.

## Quick Start

Pré-requisitos (Windows): Node.js, pnpm, Rust (versão fixada em `rust-toolchain.toml`, instalada via `rustup`), Visual Studio Build Tools com o workload "Desktop development with C++" e WebView2 (já presente no Windows 11).

```
pnpm install
pnpm tauri dev                  # desenvolvimento
pnpm tauri build --no-bundle    # gera src-tauri/target/release/compactfs.exe
```

O `compactfs.exe` é um executável único, sem arquivos ao lado, e foi testado rodando de uma pasta do disco interno. A execução a partir de um disco externo ainda não foi validada (ver Status). Se o WebView2 Runtime não estiver instalado, o app mostra uma mensagem em português com o link de instalação e encerra.

Testes: `cargo test --manifest-path src-tauri/Cargo.toml` (núcleo) e `pnpm test` (lógica pura da interface, com o executor de testes nativo do Node 24, sem dependência extra).

## Current Scope

Implementado (somente leitura, Windows):

- Tela **Este computador** com os discos (removíveis primeiro), rótulo e espaço livre; discos sem mídia aparecem como tal, e unidades de rede e ópticas não são consultadas (podem travar).
- **Navegação por pastas** com trilha de navegação, histórico (Voltar/Avançar), subir um nível, atualizar (F5), teclado completo e a opção "Mostrar ocultos". Pastas primeiro, ordem natural sem diferenciar maiúsculas (`arquivo2` antes de `arquivo10`). Links e junções para pastas são navegáveis.
- **Lista virtualizada:** só as linhas visíveis existem na tela, então pastas com dezenas de milhares de itens continuam fluidas.
- **Erros claros** em português (pasta removida, sem permissão, disco desconectado ou sem resposta), com saída para "Este computador".
- Barra de status com a versão, o tempo até a interface ficar pronta e o tempo de cada listagem.
- **Galeria visual** (modo padrão, alternável com **Lista**; a escolha fica guardada): miniaturas reais de imagens, vídeos e PDFs, em grade virtualizada com navegação por teclado em duas dimensões. As miniaturas vêm do próprio Windows, são pedidas só para o que está na tela (rolar rápido quase não gera pedidos) e arquivos sem miniatura mostram um ícone. A janela tem largura mínima de 640 px.

Ainda não existe abrir ou visualizar arquivos (etapa 4). O escopo planejado para o núcleo inicial, além do que já está acima, é:

- Visualizadores básicos: texto/markdown, imagem, PDF, vídeo e áudio simples (visualização em destaque).
- Busca por nome.

Plataformas-alvo: Windows, Android e iOS. A **fase 1 é só Windows**, com um executável único que serve instalado ou rodando de dentro do disco. O mobile (sempre instalado, pois Android e iOS não executam apps de um disco) vem na fase 2, depois de um protótipo curto de acesso a discos externos. O app também pode funcionar em discos internos e pastas do dispositivo.

Formatos: o núcleo cobre apenas o que a WebView e o pdf.js reproduzem nativamente. Office e codecs raros ficam como plugin ou "abrir no app padrão"; embutir ffmpeg só se o custo em tamanho for aceito depois.

Fora do núcleo inicial (plugin ou fase posterior): gerenciamento de arquivos, edição de conteúdo, metadados e organização (tags, notas, EXIF), limpeza e manutenção (duplicados, comparação entre discos). Documentos Office: cobertura a avaliar caso a caso.

Fora do escopo por enquanto: sincronização em nuvem, editor profissional (Photoshop, Premiere, Word), gestão de disco/partições e ferramenta de backup.

## Regras do Produto

- **Prioridade central:** leve, simples, rápido e intuitivo. Qualquer funcionalidade que comprometa isso fica fora do núcleo.
- **Somente leitura (por enquanto):** a navegação não cria, altera nem apaga nada no disco. Nomes de arquivo são dados não confiáveis e sempre exibidos como texto, nunca interpretados como HTML.
- **Disco que some:** se um disco for desconectado com uma pasta aberta, a próxima listagem ou atualização mostra uma mensagem clara em vez de travar. O app ainda não detecta a remoção sozinho.
- **Exclusão:** direta, com confirmação clara (sem lixeira própria nem do SO). É irreversível.
- **Salvamento:** ao editar, grava em arquivo temporário e substitui o original ao final (atômico), para não corromper se o disco for desconectado.
- **Miniaturas:** geradas pelo próprio Windows (decisão tomada por causa do peso zero e da cobertura de vídeo e PDF). O app não grava nada por conta própria e guarda só até 240 miniaturas na memória. **Consequência de privacidade, conhecida e aceita:** o Windows registra essas miniaturas no cache dele (`thumbcache`) da máquina que está rodando o app, como o Explorer já faz. Ver o seu disco num computador emprestado pode deixar miniaturas das suas fotos nesse computador. Se isso virar problema, a alternativa é decodificar as imagens dentro do app (a custo de cerca de 1 MB no executável, e só imagens).
- **Cache/índice:** local configurável, com padrão no dispositivo, para não poluir nem desgastar o disco. O modo portátil pode guardar cache no próprio disco, sob configuração. (Ainda não há índice nem cache próprio em disco.)
- **Dados do WebView2:** o WebView2 grava seu perfil (cerca de 10 MB) no dispositivo, em `%LOCALAPPDATA%\dev.otterdev.compactfs`. Isso é aceito: a máquina que roda o app guarda esse perfil. Rodando de uma pasta do disco interno, nada foi criado ao lado do executável; o comportamento a partir de um disco externo ainda não foi validado.
- **Plugins:** apenas internos, por enquanto, como **módulos compilados e ativáveis** (sem carregamento dinâmico). O núcleo básico deve poder funcionar sozinho, com fronteiras limpas entre módulos; extensões adicionam as funções extras. Extensão dinâmica (ex.: WASM) só será considerada se terceiros entrarem.

## Status

Etapas 1 (spike no Windows), 2 (navegação por pastas) e 3 (galeria com miniaturas) concluídas, **com a validação em disco externo e em HD mecânico pendente**. Próximo passo: visualizadores básicos (etapa 4).

Medições (Windows 11, uma máquina, disco SSD SATA formatado em NTFS, build release; "MiB" = 1024² bytes):

- Executável: 2,96 MiB (3.108.864 bytes); a navegação acrescentou cerca de 39 KB aos 3.045.888 bytes do spike, e as miniaturas, cerca de 23 KB.
- Galeria, numa pasta com 410 itens (400 JPEGs de 1600x1200, três fotos de 24 megapixels e outros formatos): primeira miniatura em cerca de 140 a 160 ms e a primeira tela inteira (18 miniaturas) pouco depois; atravessar os 410 itens rolando rápido gerou só 29 pedidos de miniatura; reabrir uma pasta já vista não faz pedido nenhum. Uma pasta com 50.000 arquivos abre em galeria em cerca de 160 ms.
- Memória com a galeria cheia (depois de rolar os 410 itens): cerca de 475 MB de working set e 305 MB de memória privada, contra 355 MB e 170 MB na lista parada. O custo extra vem das miniaturas em memória (até 240) e do WebView2; vale reduzir o limite de cache se a meta de leveza apertar.
- Interface pronta (da entrada de `run()` até a interface chamar o comando): cerca de 270 a 300 ms com o perfil do WebView2 já criado, com outliers ocasionais acima de 700 ms; cerca de 1,2 a 1,4 s no primeiro lançamento de um executável recém-copiado (provável verificação do antivírus).
- Pasta com 50.000 arquivos: listada e ordenada no núcleo em cerca de 90 a 120 ms (150 a 190 ms no total, e cerca de 170 ms do clique até a lista na tela), com apenas 24 linhas no DOM.
- Memória, somando só o app e os processos do WebView2 que ele criou (7 processos): cerca de 355 MB de working set e 165 MB de memória privada parado; cerca de 410 MB e 230 MB com os 50.000 itens na tela. A maior parte é do WebView2, não do app, e conta para a meta de leveza.

Testes: 49 no núcleo (listagem, ordenação, erros, discos, miniaturas com cores, transparência e orientação conferidas, contrato IPC, configuração de segurança), 41 na lógica da interface (lista, grade, fila e cache de miniaturas) e dois testes de ponta a ponta manuais (31 verificações na lista e 27 na galeria, dirigindo o executável de verdade) que não estão na CI. As mutações aplicadas ao código novo morrem pelos testes, exceto o contador de itens ilegíveis e o caminho de "disco sem mídia", que não dá para exercitar sem hardware ou permissões específicas.

Não validado ainda: **miniaturas de vídeo** (não havia nenhum vídeo nem `ffmpeg` nesta máquina) e formatos que dependem de codec instalado (HEIC, RAW); **PDF**, que nesta máquina **não gerou miniatura** porque o Windows daqui não tem tratador de PDF (o resultado depende do que cada computador tem instalado); HD mecânico (só havia SSDs; ler e gerar miniaturas de pastas grandes pode ser bem mais lento), execução a partir de um disco externo real (exFAT/NTFS) e em outra máquina (SmartScreen, antivírus), remoção física de um disco com a pasta aberta, unidades de rede, caminhos com mais de 260 caracteres, uso com leitor de tela e um extrator de miniatura do Windows que trave (cada pedido tem limite de 10 s, mas a thread presa fica para trás).

Em aberto:

- Metas mensuráveis de leveza e velocidade (tamanho do executável, tempo de abertura, fluidez ao listar pastas grandes, inclusive em HD mecânico): definir com base nas medições acima.
- Viabilidade de executar de dentro de um disco externo em máquinas de terceiros (SmartScreen, antivírus, WebView2 disponível): validar com testes manuais quando houver um disco externo e outra máquina à mão.
- Acesso a discos externos no Android (Storage Access Framework) e no iOS: validar num protótipo antes da fase 2.

## Stack

Fase 1 (Windows): **Tauri 2** (núcleo em Rust 1.99.1, fixado em `rust-toolchain.toml`; interface em TypeScript 7 + Vite 8, sem framework) com **pnpm** 11. A viabilidade do Tauri no mobile (fase 2) segue a validar. O `crate-type` mobile e as features padrão do Tauri ficam mantidos na fase 1.

Dependências diretas e impacto (executável final de 2,96 MiB). A navegação e a galeria não adicionaram nenhuma dependência ao executável nem ao pacote JavaScript; o `Cargo.lock` ganhou 4 pacotes na etapa 2 (`tempfile` e o que ela puxa: `errno`, `rustix` e `linux-raw-sys`), todos só de desenvolvimento e fora do grafo normal e de build, e nenhum na etapa 3:

| Dependência | Uso | Impacto |
| --- | --- | --- |
| `tauri` 2 | Janela, WebView2 e IPC | Quase todo o peso do executável |
| `serde` | Serializar a resposta do comando | Já era transitiva; peso zero |
| `webview2-com`, `windows` (só Windows) | Checar o WebView2, mostrar a mensagem em português, listar os discos e obter as miniaturas do sistema | Mesmas versões que o Tauri já usa; sem crate nova. Features acrescentadas: `Win32_Storage_FileSystem` e `Win32_System_Diagnostics_Debug` (discos) e `Win32_UI_Shell` e `Win32_Graphics_Gdi` (miniaturas), todas já ativadas pelo Tauri |
| `@tauri-apps/api` | Chamar comandos do núcleo | Cerca de 1 kB no JavaScript entregue |
| `vite`, `typescript`, `@tauri-apps/cli` | Build do frontend e do app | Só ferramentas de build; nada entra no executável |
| `tauri` com feature `test`, `serde_json`, `tempfile` | Testes de IPC e de listagem em pastas temporárias | Só `dev-dependencies`; não entram no executável |
| Executor de testes nativo do Node 24 | Testes da lógica da interface (`pnpm test`) | Nenhuma dependência: o Node 24 executa TypeScript direto |

## Licença

[MIT](./LICENSE).
