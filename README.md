# CompactFS

App leve e rápido para visualizar (e, em fases posteriores, editar) arquivos em discos portáteis, como HDs e SSDs externos, voltado a público geral. Nome do produto: **CompactFS** (ver Identidade).

## Quick Start

Pré-requisitos (Windows): Node.js, pnpm, Rust (versão fixada em `rust-toolchain.toml`, instalada via `rustup`), Visual Studio Build Tools com o workload "Desktop development with C++" e WebView2 (já presente no Windows 11).

```
pnpm install
pnpm tauri dev                  # desenvolvimento
pnpm tauri build --no-bundle    # gera src-tauri/target/release/compactfs.exe
```

Protótipo Android (etapa 7): JDK 17, Android SDK (plataforma 36, build-tools 36.0.0 e NDK 28.2.13676358), os alvos `aarch64-linux-android` e `x86_64-linux-android` do Rust, as variáveis `JAVA_HOME`, `ANDROID_HOME` e `NDK_HOME`, e o **Modo de Desenvolvedor do Windows ligado** (o Tauri cria links simbólicos). Com o aparelho conectado por USB (depuração USB ligada):

```
pnpm tauri android build --debug --target aarch64 --apk     # APK em src-tauri/gen/android/app/build/outputs/apk/universal/debug
adb install -r <o APK acima>
```

Se o Gradle reclamar que não encontra `pnpm.bat`, crie um `pnpm.bat` com `call pnpm.cmd %*` numa pasta do `PATH` (o plugin do Gradle só procura essa extensão).

O `compactfs.exe` é um executável único, sem arquivos ao lado, e foi testado rodando de uma pasta do disco interno. A execução a partir de um disco externo ainda não foi validada (ver Status). Se o WebView2 Runtime não estiver instalado, o app mostra uma mensagem em português com o link de instalação e encerra.

Testes: `cargo test --manifest-path src-tauri/Cargo.toml` (núcleo) e `pnpm test` (lógica pura da interface, com o executor de testes nativo do Node 24, sem dependência extra) e, com o app aberto em modo de depuração, `node e2e/address.mjs` (teste de ponta a ponta da barra de endereço; o passo a passo está no cabeçalho de `e2e/cdp.mjs`, e ele não roda na CI).

## Current Scope

Implementado (somente leitura, Windows):

- Tela **Este computador** com os discos (removíveis primeiro), rótulo e espaço livre; discos sem mídia aparecem como tal, e unidades de rede e ópticas não são consultadas (podem travar).
- **Navegação por pastas** com trilha de navegação, histórico (Voltar/Avançar), subir um nível, atualizar (F5), teclado completo e a opção "Mostrar ocultos". Pastas primeiro, ordem natural sem diferenciar maiúsculas (`arquivo2` antes de `arquivo10`). Links e junções para pastas são navegáveis.
- **Lista virtualizada:** só as linhas visíveis existem na tela, então pastas com dezenas de milhares de itens continuam fluidas.
- **Erros claros** em português (pasta removida, sem permissão, disco desconectado ou sem resposta), com saída para "Este computador".
- Barra de status com a versão, o tempo até a interface ficar pronta e o tempo de cada listagem.
- **Galeria visual** (modo padrão, alternável com **Lista**; a escolha fica guardada): miniaturas reais de imagens, vídeos e PDFs, em grade virtualizada com navegação por teclado em duas dimensões. As miniaturas vêm do próprio Windows, são pedidas só para o que está na tela (rolar rápido quase não gera pedidos) e arquivos sem miniatura mostram um ícone. A janela tem largura mínima de 640 px.

- **Visualizadores** (Enter ou duplo clique num arquivo; ←/→ ou Page Up/Page Down trocam de arquivo, Esc volta e devolve a seleção): **imagem** com ajuste à janela, zoom (roda do mouse, `+`, `-`, `0` ajusta, `1` a 100%, duplo clique) e arrasto; **vídeo** e **áudio** com os controles do navegador (reproduzir, avançar no tempo, volume); **PDF** pelo visualizador nativo do WebView2 (zoom, páginas, busca); **texto** (UTF-8, UTF-16 e ANSI/Windows-1252 detectados; só o primeiro 1 MiB de arquivos grandes, com aviso; arquivo binário é recusado com mensagem clara); **markdown** formatado (títulos, listas, tarefas, tabelas, código, citações) com botão para ver o código-fonte. Fechar o visualizador solta o arquivo, mesmo com um vídeo tocando.
- **Abrir no app padrão** do Windows (Ctrl+Enter, botão do visualizador, ou Enter num arquivo sem visualizador, como Office ou TIFF). Programas, scripts, atalhos, instaladores e documentos com macros nunca são abertos pelo app.
- **Sempre abrir com o app padrão** (caixa na barra superior, desligada por padrão): com ela ligada, Enter e duplo clique num arquivo abrem sempre o app padrão do sistema, em vez dos visualizadores do CompactFS (imagem, vídeo, áudio, PDF, texto e markdown). Pastas continuam navegando, as miniaturas continuam, e os tipos bloqueados (programas, scripts, atalhos, instaladores) continuam recusados. A escolha fica guardada no dispositivo, como o modo Galeria/Lista. Vale também no Android.

- **Barra de endereço editável** (clique num espaço vazio da trilha, Ctrl+L, F4 ou Alt+D): digite ou cole um caminho e Enter navega; Esc ou clicar fora cancela. Aceita o caminho entre aspas (como o "Copiar como caminho" do Windows), barras normais, `D:` (raiz do disco), `..` e caminhos relativos à pasta aberta, e "Este computador". Um arquivo abre a pasta dele com o arquivo selecionado. Caminho inexistente mantém o campo aberto, marcado em vermelho, com a mensagem na barra de status.
- **Busca por nome** (Ctrl+F ou o campo da barra superior; Enter ou uma pausa de 300 ms dispara; Esc limpa): procura na pasta aberta e em todas as subpastas, sem diferenciar maiúsculas nem acentos, e várias palavras valem como "e" (todas precisam aparecer no nome). Os resultados chegam aos poucos, as pastas mais próximas primeiro, na mesma lista ou galeria, com a pasta de cada item no tooltip e a contagem na faixa acima; "Mostrar na pasta" (Shift+Enter) leva ao item. Uma nova busca ou fechar a faixa cancela a anterior. O resultado para em 10.000 itens, com aviso. A busca respeita "Mostrar ocultos".

O escopo planejado do núcleo inicial está completo; falta apenas medir e fixar as metas de leveza (etapa 6).

Plataformas-alvo: Windows, Android e iOS. A **fase 1 é só Windows**, com um executável único que serve instalado ou rodando de dentro do disco. O mobile (sempre instalado, pois Android e iOS não executam apps de um disco) vem na fase 2, depois de um protótipo curto de acesso a discos externos. O app também pode funcionar em discos internos e pastas do dispositivo.

**Protótipo Android (etapa 7; não é entrega da fase 1):** o mesmo núcleo e a mesma interface rodam no Android (testado num Galaxy S22, Android 16), com o acesso a arquivos pelo modo "acesso a todos os arquivos":

- Tela de armazenamentos (interno e volumes removíveis encontrados em `/proc/mounts`, com espaço livre); a trilha começa no nome do armazenamento e "Subir" na raiz volta a ela.
- Faixa de pedido da permissão "Acesso a todos os arquivos" (Android 11+), que abre a tela do sistema; ao voltar, o app confere de novo e recarrega a pasta.
- Miniaturas de imagem, vídeo e PDF, visualizadores (imagem, vídeo e áudio pelo WebView; PDF desenhado página a página pelo `PdfRenderer`; texto e markdown), busca por nome, barra de endereço e "Abrir no app padrão" (intenção `VIEW` com `FileProvider`).
- Barra superior em quatro linhas em telas estreitas (navegação e modo de exibição; caminho; busca; opções), com alvos de 44 px no toque.
- **Ainda não feito:** o botão Voltar do Android ligado ao histórico, zoom por pinça e toque longo, o nome (rótulo) real dos volumes removíveis, e qualquer teste com **disco externo**.

Formatos: o núcleo cobre apenas o que o WebView2 reproduz nativamente (por isso **não há pdf.js** na fase 1: o PDF usa o visualizador do próprio WebView2, sem peso novo). Office e codecs raros ficam como plugin ou "abrir no app padrão"; embutir ffmpeg só se o custo em tamanho for aceito depois. O WebView do Android não tem visualizador de PDF: o protótipo usa o `PdfRenderer` do próprio sistema (sem peso novo no app), em vez do pdf.js.

Fora do núcleo inicial (plugin ou fase posterior): gerenciamento de arquivos, edição de conteúdo, metadados e organização (tags, notas, EXIF), limpeza e manutenção (duplicados, comparação entre discos). Documentos Office: cobertura a avaliar caso a caso.

Fora do escopo por enquanto: sincronização em nuvem, editor profissional (Photoshop, Premiere, Word), gestão de disco/partições e ferramenta de backup.

## Identidade

- **Nome:** **CompactFS**, em inglês, para funcionar internacionalmente. Passa a ideia de um sistema de arquivos compacto e portátil para ver e (depois) manipular arquivos, com visual e uso confortáveis. O app **não** é um sistema de arquivos de verdade nem comprime nada: a tagline existe para deixar isso claro.
- **CFS:** só como apelido e nos ícones dentro do projeto, nunca como nome de marca, porque a sigla já é muito usada por outras ferramentas (escalonador do Linux, NASA cFS, FastCFS, Cloudflare CFSSL).
- **Tagline:** "Your portable drives, at a glance." (alternativa descartada por ora: "A light, fast viewer for external drives.").
- **Ideia visual:** separar o `C` de **C**ompact do `FS` de **F**ile**S**ystem. O `C` aberto "olha" para o `FS`, que fica num bloco como uma miniatura da galeria ou um disco encaixado.
- **Tipografia:** Nunito (licença SIL OFL, livre para uso em logo), pesos 600 (`Compact`) e 700 (`FS`). O logo final usa o texto convertido em contornos; a fonte **não** é embarcada no app (a interface continua com a fonte do sistema, por causa do peso).
- **Cores** (sensação convencional, não universal: azul-noite = sobriedade e tecnologia; menta = frescor e velocidade):

  | Papel | Cor | Contraste |
  | --- | --- | --- |
  | Fundo do ícone, `FS` e "Compact" em fundo claro | azul-noite `#14123A` | `C` branco no fundo: 17,8:1 |
  | Bloco `FS` | menta `#2DD4BF` | `FS` no bloco: 9,6:1 |
  | `C` e "Compact" em fundo escuro | branco `#FFFFFF` | |

- **Ícone** (grade de 100; cantos do ícone de 9): `C` branco em arco, traço de 7,5, 35,6 de largura por 45,6 de altura; bloco menta quadrado de 44,6, cantos de 8, com o centro alinhado ao do `C`; `FS` com altura de letra de 22 (49% do bloco); margens laterais de 6,9 e espaço de 6 entre o `C` e o bloco.
- **Logo horizontal:** "Compact" seguido do bloco `FS`, mais largo que o do ícone (cerca de 1,75:1, proporção do primeiro esboço). Em fundo escuro: texto branco e bloco menta. Em **fundo claro o bloco é invertido** (azul-noite com `FS` menta), porque menta sobre branco tem só 1,9:1 de contraste.
- **Tamanhos:** o `FS` lê bem de 32 px para cima e no limite em 24 px; abaixo disso (16 a 20 px) o bloco vai sem letras.
- **Plataformas:** Windows com `.ico` (16, 32, 48 e 256 px); Android com ícone adaptativo (fundo azul-noite cheio, sem cantos arredondados, conteúdo dentro da zona segura de 66 dp, num canvas de 108 dp), ícone monocromático (Android 13+, `FS` vazado no bloco) e 512 px para a Play Store, também com fundo cheio.
- **Arquivos:** os mestres vetoriais ficam em `assets/brand/` (`icon.svg`, `icon-small.svg` sem letras, `icon-square.svg` para a loja, `android-foreground/background/monochrome.svg`, `logo-light.svg` e `logo-dark.svg`), com o texto já em contornos. O Windows usa `src-tauri/icons/icon.ico` com frames de 16, 20, 24, 32, 48, 64, 128 e 256 px (16 e 20 sem letras), e os demais PNGs vêm do `pnpm tauri icon`. Os recursos do Android (mipmaps) e o PNG de 512 px da Play Store saem dos mestres na etapa do mobile.
- **Pendências:** em barra de tarefas escura o azul-noite do ícone quase some nas bordas (cerca de 1,1:1 contra `#202020`; o `C` branco e o bloco menta continuam legíveis). Testar no Windows de verdade e, se preciso, acrescentar uma borda fina mais clara. Também falta a **checagem de marca** (INPI e lojas) antes da Play Store. A checagem de nome feita até aqui foi só uma triagem: sem conflito direto no GitHub, npm e crates.io, e domínios `compactfs` possivelmente livres (consulta de DNS, a confirmar no registrador).

## Regras do Produto

- **Prioridade central:** leve, simples, rápido e intuitivo. Qualquer funcionalidade que comprometa isso fica fora do núcleo.
- **Somente leitura (por enquanto):** a navegação e os visualizadores não criam, alteram nem apagam nada no disco. Nomes de arquivo e conteúdo de arquivos são dados não confiáveis e sempre exibidos como texto, nunca interpretados como HTML. (A barra do visualizador de PDF do WebView2 tem "Salvar" e "Imprimir": são ações explícitas do usuário, fora do controle do app.)
- **Acesso do visualizador aos arquivos:** o protocolo de arquivos do app começa **sem acesso a nada**; abrir um arquivo num visualizador libera só aquele arquivo (e ele fica liberado até o app fechar). A política de conteúdo só deixa imagem, mídia e o quadro do PDF virem desse protocolo: nada de endereços externos, `data:` ou `blob:`.
- **Markdown:** vira uma árvore de dados e é desenhado só com texto; HTML embutido aparece como texto literal. Links e imagens do documento **nunca** são ativados (o link mostra o endereço ao passar o mouse, e a imagem vira o texto alternativo), então um arquivo não consegue levar o app a outro endereço nem carregar conteúdo remoto.
- **Abrir no app padrão:** sem confirmação, como um duplo clique no Explorer, **exceto** programas, bibliotecas, scripts, atalhos, instaladores, arquivos de configuração que disparam ações e documentos do Office com macros ou add-ins (lista no código). O nome é normalizado antes de olhar a extensão (ponto ou espaço no fim, fluxos alternativos do NTFS) e arquivos sem extensão também são recusados. Limitação conhecida: documentos antigos (`.doc`, `.xls`, `.ppt`) podem conter macros e são abertos; o Office pergunta antes de executá-las.
- **Sempre abrir com o app padrão:** é uma preferência explícita do usuário, guardada só no dispositivo (no armazenamento local do WebView, como a escolha Galeria/Lista); desligada, nada muda. Ligada, **não há alternativa interna**: se o sistema não tiver um app para o tipo, o app mostra a mensagem do sistema em vez de abrir o visualizador próprio (basta desligar a caixa). As regras de bloqueio e normalização do nome valem do mesmo jeito.
- **Barra de endereço:** só consulta metadados do caminho digitado (não lista, não abre e não libera nada para os visualizadores). Variáveis de ambiente (`%USERPROFILE%`) e sugestões ao digitar **não** são suportadas. Caminhos de rede digitados à mão são consultados e podem demorar se o servidor não responder.
- **Busca:** só por nome (não lê o conteúdo dos arquivos) e não cria índice nem cache. Junções e links de pasta **não são seguidos** na busca (evita ciclos e sair do disco); pastas ilegíveis são puladas e contadas. Itens e pastas ocultos só entram quando "Mostrar ocultos" está ligado.
- **Android, acesso a arquivos:** o padrão é o modo "acesso a todos os arquivos" (`MANAGE_EXTERNAL_STORAGE`). O app **nunca concede a permissão sozinho**: só abre a tela do sistema, e o usuário liga a chave. Sem ela o app mostra uma faixa de aviso e enxerga só o que o sistema libera (por exemplo, nenhum arquivo solto na raiz). Antes do Android 11 a permissão não existe e o app não pede nada. O modo SAF (pasta a pasta) só será feito se a Play Store exigir. Pastas que o Android protege (como `Android/data`) continuam negadas, com mensagem.
- **Android, miniaturas e PDF:** gerados em memória pelas classes do sistema (`BitmapFactory`, `MediaMetadataRetriever`, `PdfRenderer`); o app não grava nada. "Abrir no app padrão" segue a mesma lista de bloqueio do Windows, com os instaladores `.apk`, `.apks`, `.xapk` e `.apkm` incluídos.
- **Disco que some:** se um disco for desconectado com uma pasta aberta, a próxima listagem ou atualização mostra uma mensagem clara em vez de travar. O app ainda não detecta a remoção sozinho.
- **Exclusão:** direta, com confirmação clara (sem lixeira própria nem do SO). É irreversível.
- **Salvamento:** ao editar, grava em arquivo temporário e substitui o original ao final (atômico), para não corromper se o disco for desconectado.
- **Miniaturas:** geradas pelo próprio Windows (decisão tomada por causa do peso zero e da cobertura de vídeo e PDF). O app não grava nada por conta própria e guarda só até 240 miniaturas na memória. **Consequência de privacidade, conhecida e aceita:** o Windows registra essas miniaturas no cache dele (`thumbcache`) da máquina que está rodando o app, como o Explorer já faz. Ver o seu disco num computador emprestado pode deixar miniaturas das suas fotos nesse computador. Se isso virar problema, a alternativa é decodificar as imagens dentro do app (a custo de cerca de 1 MB no executável, e só imagens).
- **Cache/índice:** local configurável, com padrão no dispositivo, para não poluir nem desgastar o disco. O modo portátil pode guardar cache no próprio disco, sob configuração. (Ainda não há índice nem cache próprio em disco.)
- **Dados do WebView2:** o WebView2 grava seu perfil (cerca de 10 MB) no dispositivo, em `%LOCALAPPDATA%\dev.otterdev.compactfs`. Isso é aceito: a máquina que roda o app guarda esse perfil. Rodando de uma pasta do disco interno, nada foi criado ao lado do executável; o comportamento a partir de um disco externo ainda não foi validado.
- **Plugins:** apenas internos, por enquanto, como **módulos compilados e ativáveis** (sem carregamento dinâmico). O núcleo básico deve poder funcionar sozinho, com fronteiras limpas entre módulos; extensões adicionam as funções extras. Extensão dinâmica (ex.: WASM) só será considerada se terceiros entrarem.

## Status

Etapas 1 (spike no Windows), 2 (navegação por pastas), 3 (galeria com miniaturas), 4 (visualizadores básicos) e 5 (busca por nome) concluídas, **com a validação em disco externo e em HD mecânico pendente**. A etapa 6 (metas de leveza e velocidade) está definida e aprovada. A etapa 7 (protótipo Android) está **funcionando no armazenamento interno de um Galaxy S22, mas ainda sem teste com disco externo**: esse teste é o que falta para decidir a fase 2.

Medições (Windows 11, uma máquina, disco SSD SATA formatado em NTFS, build release; "MiB" = 1024² bytes):

- Executável: 3,13 MiB (3.281.408 bytes); a busca acrescentou cerca de 27 KB, os ícones novos cerca de 2 KB, a barra de endereço cerca de 14 KB e o código do Android (comandos e interface por toque, que no Windows só respondem "não se aplica") cerca de 33 KB, sem dependência nova. A navegação acrescentou cerca de 39 KB aos 3.045.888 bytes do spike, as miniaturas cerca de 23 KB e os visualizadores cerca de 94 KB (protocolo de arquivos, a crate `http-range` e o código dos visualizadores e do markdown). O JavaScript entregue tem 45,3 kB (16,1 kB comprimido).
- Visualizadores: um texto abre em cerca de 30 ms e o primeiro 1 MiB de um log de 2 MB em cerca de 80 ms; uma foto de 4000x3000 (12 megapixels) termina de carregar em cerca de 25 ms (a decodificação vem logo depois, e o "Carregando…" fica na tela até a imagem estar pronta para pintar); um vídeo MP4 (H.264) e um áudio M4A (AAC) tocam e permitem avançar no tempo.
- Memória com uma foto de 12 megapixels aberta no visualizador: cerca de 515 MB de working set e 320 MB de memória privada, contra 355 MB e 170 MB na lista parada. A decodificação da foto grande e o WebView2 explicam a diferença; é o ponto mais pesado até agora.
- Galeria, numa pasta com 410 itens (400 JPEGs de 1600x1200, três fotos de 24 megapixels e outros formatos): primeira miniatura em cerca de 140 a 160 ms e a primeira tela inteira (18 miniaturas) pouco depois; atravessar os 410 itens rolando rápido gerou só 29 pedidos de miniatura; reabrir uma pasta já vista não faz pedido nenhum. Uma pasta com 50.000 arquivos abre em galeria em cerca de 160 ms.
- Memória com a galeria cheia (depois de rolar os 410 itens): cerca de 475 MB de working set e 305 MB de memória privada, contra 355 MB e 170 MB na lista parada. O custo extra vem das miniaturas em memória (até 240) e do WebView2; vale reduzir o limite de cache se a meta de leveza apertar.
- Interface pronta (da entrada de `run()` até a interface chamar o comando): cerca de 270 a 300 ms com o perfil do WebView2 já criado, com outliers ocasionais acima de 700 ms; cerca de 1,2 a 1,4 s no primeiro lançamento de um executável recém-copiado (provável verificação do antivírus).
- Pasta com 50.000 arquivos: listada e ordenada no núcleo em cerca de 90 a 120 ms (150 a 190 ms no total, e cerca de 170 ms do clique até a lista na tela), com apenas 24 linhas no DOM.
- Busca: numa árvore de mais de 50.000 arquivos em 32 pastas, uma busca com poucos resultados termina em cerca de 70 a 80 ms; dez mil resultados na lista deixam o app em cerca de 455 MB de working set e 270 MB de memória privada (contra 355 MB e 170 MB parado), por causa do WebView2 e das linhas guardadas.
- **Android** (Galaxy S22 SM-S901E, Android 16, arm64, armazenamento interno; APK de lançamento assinado com a chave de depuração):
  - APK sem assinatura: 5,70 MiB (5.973.686 bytes): biblioteca nativa em Rust cerca de 4,3 MB, código Kotlin e Java cerca de 0,7 MB e recursos cerca de 0,8 MB. Os dois plugins em Kotlin somam cerca de 5 KB de código, e o `PdfRenderer` não pesa nada (é do sistema). Desde a primeira medição do protótipo (5,58 MiB) o aumento foi de 1,7%, vindo sobretudo do Rust (armazenamentos, plugins e comandos) e dos ícones.
  - Abertura a frio (`am start -W`, 5 vezes): 138 a 170 ms (mediana 148 ms); interface pronta (rodapé do app): 226 a 258 ms.
  - Memória parado em "Este computador": 143 MB (PSS) no app e cerca de 56 MB (PSS) no processo do WebView. No build de **depuração** (indicativo, maior que o de lançamento): 190 MB parado, 277 MB com a galeria de `Download` cheia de miniaturas e 352 MB com um PDF de 2 páginas aberto.
  - Listar uma pasta de 31 itens: 8 ms (27 ms no total); busca em `Download`: 6 a 8 ms. Busca no armazenamento inteiro (383 pastas, 2.402 resultados): 4,6 a 5,3 s, cerca de 12 ms por pasta, e o custo é o próprio Android ler cada pasta (uma busca sem nenhum resultado leva o mesmo). Primeira página de um PDF pronta em 65 a 77 ms.
  - Ler os metadados completos só das entradas que casam na busca não mudou o Windows (58 ms contra 57 ms em 50.000 arquivos) e economiza uma leitura por entrada no Android.
- Memória, somando só o app e os processos do WebView2 que ele criou (7 processos): cerca de 355 MB de working set e 165 MB de memória privada parado; cerca de 410 MB e 230 MB com os 50.000 itens na tela. A maior parte é do WebView2, não do app, e conta para a meta de leveza.

Testes: 125 no núcleo (listagem, ordenação, erros, discos e armazenamentos do Android, miniaturas, leitura de texto e detecção de codificação, bloqueio de executáveis e instaladores, escopo do protocolo de arquivos, busca, resolução do caminho digitado, decodificação do que vem do plugin Android, contrato IPC, configuração de segurança), 121 na lógica da interface (lista, grade, fila e cache de miniaturas, tipos, zoom, o parser de markdown, inclusive contra entradas hostis, o modelo da busca, da barra de endereço, do acesso a arquivos, dos discos, das páginas de PDF e da política de abertura) e três testes de ponta a ponta no repositório, fora da CI: `e2e/address.mjs` (33 verificações, dirige o executável do Windows), `e2e/open-default.mjs` (24 verificações; **intercepta** a chamada de rede do `open_default` para não abrir programas de verdade, e aborta se a interceptação não estiver ativa) e `e2e/android.mjs` (16 verificações, dirige o WebView do aparelho por USB; precisa do APK de depuração e só lê, sem escrever no aparelho). **Os quatro testes de ponta a ponta anteriores (31 verificações na lista, 27 na galeria, 61 nos visualizadores e 35 na busca) rodaram e passaram nas etapas 2 a 5, mas os scripts ficavam numa pasta temporária que foi apagada e não existem mais**: as verificações dessas etapas hoje valem só como histórico e precisam ser reescritas em `e2e/` para voltarem a proteger o app. As mutações aplicadas ao código novo morrem pelos testes, exceto o contador de itens ilegíveis (na busca também), o caminho de "disco sem mídia", a abertura real de programas (que nunca é exercitada de propósito) e o fechamento da edição do endereço ao navegar (redundante: a própria navegação já tira o foco do campo).

O teste de ponta a ponta de "Sempre abrir com o app padrão" cobre: desligada, o visualizador próprio abre e nada vai ao app padrão; ligada, texto, imagem, PDF e markdown vão ao app padrão (por duplo clique e por Enter) sem abrir o visualizador, com a mensagem no status; pasta continua navegando; um `.exe` continua recusado pelo núcleo; a escolha persiste ao recarregar; e desligar devolve o visualizador.

O teste de ponta a ponta do Android cobre: o plugin Kotlin respondendo sobre a permissão e a faixa de pedido escondida quando concedida; a tela de armazenamentos com o espaço livre; a trilha começando no nome do armazenamento e "Subir" voltando a ele; a página sem estourar a largura da tela; abrir pastas pelo toque; miniatura real de uma imagem; o visualizador de imagem; o PDF desenhado em páginas e com conteúdo (não em branco); a busca por nome; e nenhum erro de console.

Os testes de ponta a ponta da barra de endereço cobrem: abrir e fechar a edição (Ctrl+L, F4, Alt+D, clique num espaço vazio, Esc e perder o foco); caminho completo, entre aspas, com barras normais e com espaços e barra no fim; caminhos relativos e `..`; um arquivo abrindo a pasta dele com ele selecionado; `d:` e "este computador"; caminho inexistente e texto vazio (campo aberto, marcado como inválido, com a mensagem); Backspace dentro do campo sem subir de pasta; o histórico (Alt+←); e nenhum erro de console.

Os testes de ponta a ponta da busca (histórico, ver acima) cobriam: Ctrl+F, os resultados mais próximos primeiro e a pasta de origem de cada um; várias palavras; os ocultos ligando e desligando; a junção para a raiz (ciclo) não seguida; Enter num resultado abrindo o visualizador e voltando com a seleção; Shift+Enter e "Mostrar na pasta"; abrir uma pasta dos resultados; buscas em sequência rápida valendo só a última; Esc no meio de uma busca grande cancelando-a; o limite de 10.000 com aviso e poucas linhas no DOM; a galeria com resultados de pastas diferentes; uma árvore de 50.000+ arquivos; e nenhum erro de console.

Os testes de ponta a ponta dos visualizadores cobrem: o escopo do protocolo de arquivos (arquivo não aberto é recusado e abrir um não libera os vizinhos), a CSP, textos em três codificações, markdown rico e hostil (nenhum `<script>`, `<a>`, `<img>` nem atributo `on*`, e nenhuma requisição externa), imagem com zoom e arrasto, o PDF do WebView2, vídeo e áudio reais gerados no próprio WebView, a liberação do arquivo ao fechar (renomear durante e depois da reprodução), o bloqueio de `.exe` e `.docm`, e o Ctrl+Enter abrindo o app padrão do Windows de verdade.

Não validado ainda: **o Android com disco externo (OTG)**, com NTFS (muitos aparelhos não montam), com um HD que precise de mais energia, e em outros aparelhos além do S22; o Android antes do 11 (sem a permissão); a assinatura de lançamento, a Play Store e o alinhamento de 16 KB das bibliotecas nativas; a interface por toque (Voltar do Android, pinça, toque longo); a barra de endereço com caminhos de rede (UNC) e com mais de 260 caracteres; a busca em **HD mecânico** e em disco externo (só se mediu em SSD; varrer muitas pastas num disco lento pode demorar bem mais, e o app mostra o progresso e permite cancelar), o contador de pastas ilegíveis da busca (só por teste de unidade) e o cancelamento de uma busca por outra só pelo teste de ponta a ponta; **miniaturas de vídeo em outros formatos** além de MP4 e vídeo em MKV, HEVC e AVI (o app mostra uma mensagem e oferece o app padrão se o WebView2 não tocar); HEIC e RAW (dependem de codec instalado); **PDF**, que nesta máquina **não gerou miniatura** na galeria porque o Windows daqui não tem tratador de PDF (o visualizador, esse sim, funciona); reprodução de vídeo e avanço no tempo num disco externo lento; HD mecânico (só havia SSDs; ler e gerar miniaturas de pastas grandes pode ser bem mais lento), execução a partir de um disco externo real (exFAT/NTFS) e em outra máquina (SmartScreen, antivírus), remoção física de um disco com a pasta aberta, unidades de rede, caminhos com mais de 260 caracteres, uso com leitor de tela e um extrator de miniatura do Windows que trave (cada pedido tem limite de 10 s, mas a thread presa fica para trás).

Em aberto:

- Metas para **HD mecânico** e disco externo, que só podem ser definidas depois de medir num.
- Viabilidade de executar de dentro de um disco externo em máquinas de terceiros (SmartScreen, antivírus, WebView2 disponível): validar com testes manuais quando houver um disco externo e outra máquina à mão.
- Android: o protótipo usa o acesso total aos arquivos e só foi validado no armazenamento interno. Falta testar com um disco externo (exFAT, FAT32 e NTFS) e decidir se o modo SAF será necessário (depende da revisão da Play Store). **Metas próprias do Android** (APK, abertura, memória) ainda não foram definidas: as medições acima são a base; os tetos de 5 MiB do executável são do Windows (o APK já tem 5,70 MiB).
- iOS: sem aparelho nem Mac por enquanto; fica como planejamento futuro.
- Busca no Android: percorrer o armazenamento inteiro leva alguns segundos; ler várias pastas em paralelo pode reduzir, a avaliar.

## Metas de leveza e velocidade

**Aprovadas pelo mantenedor.** Definidas a partir das medições acima (SSD interno, uma máquina), com folga para variação de máquina. Servem como teto: passar de um deles pede uma justificativa registrada aqui, não um ajuste silencioso.

| Meta | Teto | Hoje |
| --- | --- | --- |
| Tamanho do `compactfs.exe` | 5 MiB | 3,08 MiB |
| Interface pronta (perfil do WebView2 já criado) | 500 ms | 270 a 300 ms |
| Listar uma pasta com 50.000 arquivos (do clique à lista na tela) | 500 ms | cerca de 170 ms |
| Busca numa árvore de 50.000+ arquivos, poucos resultados | 500 ms | 70 a 80 ms |
| Primeira miniatura de uma pasta de fotos | 500 ms | 140 a 160 ms |
| Memória parado (app + WebView2): working set / privada | 500 MB / 250 MB | 355 MB / 167 MB |
| Memória na pior tela medida (foto de 12 megapixels aberta) | 1.000 MB / 500 MB | 515 MB / 320 MB |

- **Verificado pela CI:** só o tamanho do executável (o build falha acima de 5 MiB). O restante é medido à mão com os testes de ponta a ponta, que não estão na CI; um valor acima do teto numa medição manual deve virar um item em "Em aberto".
- A maior parte da memória é do WebView2, não do app: reduzir de verdade pede outra estratégia (por exemplo, menos processos), fora do que a fase 1 prevê.
- Os tetos de tempo valem para SSD. Para **HD mecânico** e disco externo não há meta ainda, porque nunca foi medido.

## Stack

Fase 1 (Windows): **Tauri 2** (núcleo em Rust 1.99.1, fixado em `rust-toolchain.toml`; interface em TypeScript 7 + Vite 8, sem framework) com **pnpm** 11. A viabilidade do Tauri no mobile (fase 2) segue a validar. O `crate-type` mobile e as features padrão do Tauri ficam mantidos na fase 1.

Android (protótipo): o projeto Gradle gerado pelo Tauri fica em `src-tauri/gen/android` (`compileSdk` e `targetSdk` 36, `minSdk` 24; NDK 28.2). Os dois plugins (`StoragePlugin` e `MediaPlugin`) são classes Kotlin do próprio projeto e não adicionam biblioteca. O Rust ganhou `libc` **só no Android** (espaço livre dos armazenamentos; mesma versão que o Tauri já usa, uma linha no `Cargo.lock`, nenhum pacote novo). O Gradle do modelo do Tauri traz AndroidX e Material, cujo peso ainda será avaliado. A versão do app passou de `0.0.0` para `0.0.1`, porque o Android recusa `0.0.0`.

Dependências diretas e impacto (executável final de 3,13 MiB no Windows). A navegação, a galeria e a busca não adicionaram nenhuma dependência ao executável nem ao pacote JavaScript; o `Cargo.lock` ganhou 4 pacotes na etapa 2 (`tempfile` e o que ela puxa: `errno`, `rustix` e `linux-raw-sys`), todos só de desenvolvimento e fora do grafo normal e de build, e nenhum na etapa 3. **A etapa 4 adicionou uma crate ao executável: `http-range`** (pequena), puxada pela feature `protocol-asset` do Tauri, necessária para o vídeo e o áudio permitirem avançar no tempo. O markdown e o PDF não adicionaram dependência (parser próprio e visualizador nativo do WebView2):

| Dependência | Uso | Impacto |
| --- | --- | --- |
| `tauri` 2 (feature `protocol-asset`) | Janela, WebView2, IPC e o protocolo de arquivos dos visualizadores | Quase todo o peso do executável; a feature acrescentou a crate `http-range` e, com o código dos visualizadores, cerca de 94 KB |
| `serde` | Serializar a resposta do comando | Já era transitiva; peso zero |
| `webview2-com`, `windows` (só Windows) | Checar o WebView2, mostrar a mensagem em português, listar os discos e obter as miniaturas do sistema | Mesmas versões que o Tauri já usa; sem crate nova. Features acrescentadas: `Win32_Storage_FileSystem` e `Win32_System_Diagnostics_Debug` (discos) e `Win32_UI_Shell` e `Win32_Graphics_Gdi` (miniaturas), todas já ativadas pelo Tauri |
| `@tauri-apps/api` | Chamar comandos do núcleo | Cerca de 1 kB no JavaScript entregue |
| `vite`, `typescript`, `@tauri-apps/cli` | Build do frontend e do app | Só ferramentas de build; nada entra no executável |
| `tauri` com feature `test`, `serde_json`, `tempfile` | Testes de IPC e de listagem em pastas temporárias | Só `dev-dependencies`; não entram no executável |
| Executor de testes nativo do Node 24 | Testes da lógica da interface (`pnpm test`) | Nenhuma dependência: o Node 24 executa TypeScript direto |

## Licença

[MIT](./LICENSE).
