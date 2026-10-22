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

Testes: `cargo test --manifest-path src-tauri/Cargo.toml`.

## Current Scope

Implementado: apenas o spike de viabilidade (janela Tauri 2 que mostra versão e o tempo até a interface ficar pronta, e a checagem do WebView2). O escopo planejado para o núcleo inicial é:

- Navegação por pastas com galeria visual (miniaturas e visualização em destaque).
- Visualizadores básicos: texto/markdown, imagem, PDF, vídeo e áudio simples.
- Busca por nome.

Plataformas-alvo: Windows, Android e iOS. A **fase 1 é só Windows**, com um executável único que serve instalado ou rodando de dentro do disco. O mobile (sempre instalado, pois Android e iOS não executam apps de um disco) vem na fase 2, depois de um protótipo curto de acesso a discos externos. O app também pode funcionar em discos internos e pastas do dispositivo.

Formatos: o núcleo cobre apenas o que a WebView e o pdf.js reproduzem nativamente. Office e codecs raros ficam como plugin ou "abrir no app padrão"; embutir ffmpeg só se o custo em tamanho for aceito depois.

Fora do núcleo inicial (plugin ou fase posterior): gerenciamento de arquivos, edição de conteúdo, metadados e organização (tags, notas, EXIF), limpeza e manutenção (duplicados, comparação entre discos). Documentos Office: cobertura a avaliar caso a caso.

Fora do escopo por enquanto: sincronização em nuvem, editor profissional (Photoshop, Premiere, Word), gestão de disco/partições e ferramenta de backup.

## Regras do Produto

- **Prioridade central:** leve, simples, rápido e intuitivo. Qualquer funcionalidade que comprometa isso fica fora do núcleo.
- **Exclusão:** direta, com confirmação clara (sem lixeira própria nem do SO). É irreversível.
- **Salvamento:** ao editar, grava em arquivo temporário e substitui o original ao final (atômico), para não corromper se o disco for desconectado.
- **Cache/índice/miniaturas:** local configurável, com padrão no dispositivo, para não poluir nem desgastar o disco. O modo portátil pode guardar cache no próprio disco, sob configuração.
- **Dados do WebView2:** o WebView2 grava seu perfil (cerca de 10 MB) no dispositivo, em `%LOCALAPPDATA%\dev.otterdev.compactfs`. Isso é aceito: a máquina que roda o app guarda esse perfil. Rodando de uma pasta do disco interno, nada foi criado ao lado do executável; o comportamento a partir de um disco externo ainda não foi validado.
- **Plugins:** apenas internos, por enquanto, como **módulos compilados e ativáveis** (sem carregamento dinâmico). O núcleo básico deve poder funcionar sozinho, com fronteiras limpas entre módulos; extensões adicionam as funções extras. Extensão dinâmica (ex.: WASM) só será considerada se terceiros entrarem.

## Status

Spike no Windows concluído (etapa 1), **com a validação em disco externo pendente**. Próximo passo: navegação por pastas (etapa 2).

Medições do spike (Windows 11, NTFS, uma máquina, build release; "MiB" = 1024² bytes):

- Executável: 2,90 MiB (3.045.888 bytes).
- Interface pronta (da entrada de `run()` até a interface chamar o comando): cerca de 270 a 300 ms com o perfil do WebView2 já criado, com outliers ocasionais acima de 700 ms; cerca de 1,4 s na primeira execução.
- Memória: entre cerca de 250 MB (memória privada) e 490 MB (working set), somando o app e os processos do WebView2, conforme o método de medição. A maior parte é do WebView2, não do app, e conta para a meta de leveza.

Não validado ainda: execução a partir de um disco externo (exFAT/NTFS) e em outra máquina (SmartScreen, antivírus).

Em aberto:

- Metas mensuráveis de leveza e velocidade (tamanho do executável, tempo de abertura, fluidez ao listar pastas grandes, inclusive em HD mecânico): serão definidas com base no protótipo.
- Viabilidade de executar de dentro de um disco externo em máquinas de terceiros (SmartScreen, antivírus, WebView2 disponível): validar com testes manuais quando houver um disco externo e outra máquina à mão.
- Acesso a discos externos no Android (Storage Access Framework) e no iOS: validar num protótipo antes da fase 2.

## Stack

Fase 1 (Windows): **Tauri 2** (núcleo em Rust 1.99.1, fixado em `rust-toolchain.toml`; interface em TypeScript 7 + Vite 8, sem framework) com **pnpm** 11. A viabilidade do Tauri no mobile (fase 2) segue a validar. O `crate-type` mobile e as features padrão do Tauri ficam mantidos na fase 1.

Dependências diretas e impacto (executável final de 2,90 MiB):

| Dependência | Uso | Impacto |
| --- | --- | --- |
| `tauri` 2 | Janela, WebView2 e IPC | Quase todo o peso do executável |
| `serde` | Serializar a resposta do comando | Já era transitiva; peso zero |
| `webview2-com`, `windows` (só Windows) | Checar o WebView2 e mostrar a mensagem em português | Mesmas versões e features que o Tauri já usa; sem crate nova |
| `@tauri-apps/api` | Chamar comandos do núcleo | Cerca de 1 kB no JavaScript entregue |
| `vite`, `typescript`, `@tauri-apps/cli` | Build do frontend e do app | Só ferramentas de build; nada entra no executável |
| `tauri` com feature `test`, `serde_json` | Testes de IPC | Só `dev-dependencies`; não entram no executável |

## Licença

[MIT](./LICENSE).
