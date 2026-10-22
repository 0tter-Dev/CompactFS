# CompactFS (working title)

App leve e rápido para visualizar (e, em fases posteriores, editar) arquivos em discos portáteis, como HDs e SSDs externos, voltado a público geral. "CompactFS" (CFS) é só um nome provisório, não o nome final.

## Quick Start

Pré-requisitos (Windows): Node.js, pnpm, Rust (versão fixada em `rust-toolchain.toml`, instalada via `rustup`), Visual Studio Build Tools com o workload "Desktop development with C++" e WebView2 (já presente no Windows 11).

```
pnpm install
pnpm tauri dev                  # desenvolvimento
pnpm tauri build --no-bundle    # gera src-tauri/target/release/compactfs.exe
```

O `compactfs.exe` é um executável único: pode rodar de qualquer pasta, inclusive de dentro de um disco externo. Testes: `cargo test --manifest-path src-tauri/Cargo.toml`.

## Current Scope

Implementado: apenas o spike de viabilidade (janela Tauri 2 que mostra versão e tempo de inicialização). O escopo planejado para o núcleo inicial é:

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
- **Plugins:** apenas internos, por enquanto, como **módulos compilados e ativáveis** (sem carregamento dinâmico). O núcleo básico deve poder funcionar sozinho, com fronteiras limpas entre módulos; extensões adicionam as funções extras. Extensão dinâmica (ex.: WASM) só será considerada se terceiros entrarem.

## Status

Spike no Windows concluído (etapa 1). Próximo passo: navegação por pastas (etapa 2).

Medições do spike (Windows 11, NTFS, uma máquina, build release):

- Executável: 2,94 MB.
- Janela pronta: cerca de 270 ms com o perfil do WebView2 já criado; cerca de 1,4 s na primeira execução.
- Memória: cerca de 340 MB somando o app e os 6 processos do WebView2. A maior parte é do WebView2, não do app, e conta para a meta de leveza.

Não validado ainda: execução a partir de um disco externo (exFAT/NTFS) e em outra máquina (SmartScreen, antivírus).

Em aberto:

- Metas mensuráveis de leveza e velocidade (tamanho do executável, tempo de abertura, fluidez ao listar pastas grandes, inclusive em HD mecânico): serão definidas com base no protótipo.
- Viabilidade de executar de dentro de um disco externo em máquinas de terceiros (SmartScreen, antivírus, WebView2 disponível): validar com testes manuais.
- Acesso a discos externos no Android (Storage Access Framework) e no iOS: validar num protótipo antes da fase 2.

## Stack

Direção inicial, ainda a validar: **Tauri 2** (núcleo em Rust, interface web em TypeScript), com **pnpm** como gerenciador de pacotes do frontend. Nenhuma decisão firme sobre o restante.

## Licença

[MIT](./LICENSE).
