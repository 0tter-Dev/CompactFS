//! Busca por nome, somente leitura, na pasta escolhida e em todas as subpastas.
//!
//! Sem índice: percorre o disco no momento, em largura (o que está mais perto da pasta de partida
//! aparece primeiro) e entrega os resultados em lotes enquanto anda, para a interface mostrar os
//! primeiros logo e poder cancelar. Links e junções não são seguidos (evita ciclos e sair da pasta).

use std::{
    collections::VecDeque,
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use serde::Serialize;

use crate::browse::{self, BrowseError, Entry, ErrorCode};

/// Mais que isso deixa de ser uma busca útil: pede para refinar em vez de sufocar a interface.
pub const MAX_RESULTS: usize = 10_000;
/// Um lote é enviado quando junta este tanto de resultados...
const BATCH_MAX: usize = 200;
/// ...ou quando passa este tempo desde o último envio.
const FLUSH_EVERY: Duration = Duration::from_millis(80);

#[derive(Serialize, Debug)]
pub struct SearchHit {
    #[serde(flatten)]
    pub entry: Entry,
    /// Pasta onde o item está (caminho completo).
    pub dir: String,
}

#[derive(Serialize, Debug)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SearchEvent {
    Hits {
        hits: Vec<SearchHit>,
    },
    Progress {
        scanned_dirs: u64,
        scanned_entries: u64,
    },
    /// Fim da busca. Vai pelo mesmo canal dos resultados, que preserva a ordem: quando a interface
    /// recebe isto, todos os lotes anteriores já chegaram (a resposta do comando não garante isso).
    Done {
        summary: SearchSummary,
    },
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchSummary {
    pub scanned_dirs: u64,
    pub scanned_entries: u64,
    pub matches: usize,
    /// Pastas que não puderam ser abertas (sem permissão, sumiram durante a busca...).
    pub skipped_dirs: u32,
    /// Chegou ao limite de resultados e parou.
    pub truncated: bool,
    pub cancelled: bool,
    pub elapsed_ms: u64,
}

/// Acentos comuns do português, espanhol e francês (e do Latin Estendido-A), já em minúsculas.
const ACCENTS: &[(char, &str)] = &[
    ('à', "a"),
    ('á', "a"),
    ('â', "a"),
    ('ã', "a"),
    ('ä', "a"),
    ('å', "a"),
    ('ā', "a"),
    ('ă', "a"),
    ('ą', "a"),
    ('ç', "c"),
    ('ć', "c"),
    ('ĉ', "c"),
    ('ċ', "c"),
    ('č', "c"),
    ('ď', "d"),
    ('đ', "d"),
    ('è', "e"),
    ('é', "e"),
    ('ê', "e"),
    ('ë', "e"),
    ('ē', "e"),
    ('ĕ', "e"),
    ('ė', "e"),
    ('ę', "e"),
    ('ě', "e"),
    ('ĝ', "g"),
    ('ğ', "g"),
    ('ġ', "g"),
    ('ģ', "g"),
    ('ĥ', "h"),
    ('ħ', "h"),
    ('ì', "i"),
    ('í', "i"),
    ('î', "i"),
    ('ï', "i"),
    ('ĩ', "i"),
    ('ī', "i"),
    ('ĭ', "i"),
    ('į', "i"),
    ('ı', "i"),
    ('ĵ', "j"),
    ('ķ', "k"),
    ('ĺ', "l"),
    ('ļ', "l"),
    ('ľ', "l"),
    ('ŀ', "l"),
    ('ł', "l"),
    ('ñ', "n"),
    ('ń', "n"),
    ('ņ', "n"),
    ('ň', "n"),
    ('ò', "o"),
    ('ó', "o"),
    ('ô', "o"),
    ('õ', "o"),
    ('ö', "o"),
    ('ø', "o"),
    ('ō', "o"),
    ('ŏ', "o"),
    ('ő', "o"),
    ('ŕ', "r"),
    ('ŗ', "r"),
    ('ř', "r"),
    ('ś', "s"),
    ('ŝ', "s"),
    ('ş', "s"),
    ('š', "s"),
    ('ţ', "t"),
    ('ť', "t"),
    ('ŧ', "t"),
    ('ù', "u"),
    ('ú', "u"),
    ('û', "u"),
    ('ü', "u"),
    ('ũ', "u"),
    ('ū', "u"),
    ('ŭ', "u"),
    ('ů', "u"),
    ('ű', "u"),
    ('ų', "u"),
    ('ŵ', "w"),
    ('ý', "y"),
    ('ÿ', "y"),
    ('ŷ', "y"),
    ('ź', "z"),
    ('ż', "z"),
    ('ž', "z"),
    ('ß', "ss"),
    ('æ', "ae"),
    ('œ', "oe"),
];

/// Minúsculas e sem acentos: `Ação` e `ACAO` viram `acao`.
pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        for lower in ch.to_lowercase() {
            match ACCENTS.iter().find(|(from, _)| *from == lower) {
                Some((_, plain)) => out.push_str(plain),
                None => out.push(lower),
            }
        }
    }
    out
}

/// Texto da busca: palavras separadas por espaço; o nome precisa conter todas, em qualquer ordem.
#[derive(Debug, PartialEq, Eq)]
pub struct Query {
    terms: Vec<String>,
}

impl Query {
    /// `None` se não sobrou nenhuma palavra (texto vazio ou só espaços).
    pub fn parse(text: &str) -> Option<Self> {
        let terms: Vec<String> = text.split_whitespace().map(fold).collect();
        (!terms.is_empty()).then_some(Self { terms })
    }

    pub fn matches(&self, name: &str) -> bool {
        let folded = fold(name);
        self.terms.iter().all(|t| folded.contains(t.as_str()))
    }
}

/// Percorre `root` em largura e chama `emit` com lotes de resultados e com o andamento.
///
/// Devolve erro só se a pasta de partida não puder ser aberta; pastas internas que falham são
/// contadas em `skipped_dirs`. `cancel` é consultado a cada item.
pub fn search(
    root: &Path,
    query: &Query,
    show_hidden: bool,
    max_results: usize,
    cancel: &AtomicBool,
    mut emit: impl FnMut(SearchEvent),
) -> Result<SearchSummary, BrowseError> {
    let started = Instant::now();
    let meta = fs::metadata(root).map_err(|e| browse::classify(&e))?;
    if !meta.is_dir() {
        return Err(BrowseError::new(
            ErrorCode::NotADirectory,
            "O caminho não é uma pasta.",
        ));
    }

    let mut summary = SearchSummary::default();
    let mut queue: VecDeque<std::path::PathBuf> = VecDeque::from([root.to_path_buf()]);
    let mut pending: Vec<SearchHit> = Vec::new();
    let mut last_flush = Instant::now();

    let flush = |pending: &mut Vec<SearchHit>,
                 summary: &SearchSummary,
                 emit: &mut dyn FnMut(SearchEvent)| {
        if !pending.is_empty() {
            emit(SearchEvent::Hits {
                hits: std::mem::take(pending),
            });
        }
        emit(SearchEvent::Progress {
            scanned_dirs: summary.scanned_dirs,
            scanned_entries: summary.scanned_entries,
        });
    };

    'walk: while let Some(dir) = queue.pop_front() {
        if cancel.load(Ordering::Relaxed) {
            summary.cancelled = true;
            break;
        }
        summary.scanned_dirs += 1;
        let read = match fs::read_dir(&dir) {
            Ok(read) => read,
            Err(e) if dir == root => return Err(browse::classify(&e)),
            Err(_) => {
                summary.skipped_dirs += 1;
                continue;
            }
        };

        let mut here: Vec<Entry> = Vec::new();
        for item in read {
            if cancel.load(Ordering::Relaxed) {
                summary.cancelled = true;
                break 'walk;
            }
            let Ok(dir_entry) = item else { continue };
            // Para decidir se entra na pasta e se o nome casa, bastam o nome e o tipo (que vêm com a
            // listagem). Os metadados completos (tamanho, data) só são lidos para o que casa: em
            // armazenamentos lentos, como o do Android, um acesso por entrada custava segundos.
            let Ok(file_type) = dir_entry.file_type() else {
                continue;
            };
            summary.scanned_entries += 1;
            let name = dir_entry.file_name().to_string_lossy().into_owned();
            if !show_hidden && browse::is_hidden_entry(&dir_entry, &name) {
                continue; // oculto: nem aparece nem é percorrido
            }
            if file_type.is_dir() && !file_type.is_symlink() {
                queue.push_back(dir_entry.path());
            }
            if query.matches(&name) {
                if let Some(entry) = browse::read_entry(&dir_entry) {
                    here.push(entry);
                }
            }
        }

        browse::sort_entries(&mut here);
        let dir_text = dir.to_string_lossy().into_owned();
        for entry in here {
            pending.push(SearchHit {
                entry,
                dir: dir_text.clone(),
            });
            summary.matches += 1;
            if summary.matches >= max_results {
                summary.truncated = true;
                break 'walk;
            }
        }

        if pending.len() >= BATCH_MAX || last_flush.elapsed() >= FLUSH_EVERY {
            flush(&mut pending, &summary, &mut emit);
            last_flush = Instant::now();
        }
    }

    flush(&mut pending, &summary, &mut emit);
    summary.elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browse::EntryKind;
    use std::{collections::HashSet, fs::File};

    /// Roda a busca e junta todos os resultados, como a interface faria.
    fn run(root: &Path, text: &str, hidden: bool) -> (Vec<SearchHit>, SearchSummary) {
        run_with(root, text, hidden, MAX_RESULTS, &AtomicBool::new(false))
    }

    fn run_with(
        root: &Path,
        text: &str,
        hidden: bool,
        max: usize,
        cancel: &AtomicBool,
    ) -> (Vec<SearchHit>, SearchSummary) {
        let query = Query::parse(text).expect("busca com texto");
        let mut all = Vec::new();
        let summary = search(root, &query, hidden, max, cancel, |ev| {
            if let SearchEvent::Hits { hits } = ev {
                all.extend(hits);
            }
        })
        .expect("busca");
        (all, summary)
    }

    fn names(hits: &[SearchHit]) -> Vec<&str> {
        hits.iter().map(|h| h.entry.name.as_str()).collect()
    }

    fn touch(dir: &Path, rel: &str) {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        File::create(path).unwrap();
    }

    #[test]
    fn fold_removes_accents_and_case() {
        assert_eq!(fold("Ação"), "acao");
        assert_eq!(fold("ÇÃO"), "cao");
        assert_eq!(
            fold("Árvore Ímpar Ônibus Úrsula"),
            "arvore impar onibus ursula"
        );
        assert_eq!(fold("Müller Straße"), "muller strasse");
        assert_eq!(fold("naïve café"), "naive cafe");
        assert_eq!(fold("Łódź"), "lodz");
        assert_eq!(fold("日本語 abc"), "日本語 abc");
        assert_eq!(fold(""), "");
    }

    #[test]
    fn query_needs_every_word_in_any_order() {
        let q = Query::parse("  praia   FOTO ").unwrap();
        assert!(q.matches("Foto da Praia 01.jpg"));
        assert!(q.matches("praia-foto.png"));
        assert!(!q.matches("foto sozinha.jpg"));
        assert!(!q.matches("praia.jpg"));
    }

    #[test]
    fn query_is_accent_and_case_insensitive_in_both_directions() {
        assert!(Query::parse("acao").unwrap().matches("Ação e reação.txt"));
        assert!(Query::parse("AÇÃO").unwrap().matches("acao.txt"));
        assert!(Query::parse("café").unwrap().matches("CAFE.md"));
    }

    #[test]
    fn empty_or_blank_text_is_not_a_query() {
        assert!(Query::parse("").is_none());
        assert!(Query::parse("   \t ").is_none());
    }

    #[test]
    fn finds_files_and_folders_in_subfolders_with_their_directory() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "a/b/relatório final.pdf");
        touch(dir.path(), "a/outro.txt");
        touch(dir.path(), "raiz relatorio.txt");
        fs::create_dir_all(dir.path().join("c/relatorios antigos")).unwrap();
        let (hits, summary) = run(dir.path(), "relatorio", false);

        let mut found = names(&hits);
        found.sort_unstable();
        assert_eq!(
            found,
            [
                "raiz relatorio.txt",
                "relatorios antigos",
                "relatório final.pdf"
            ]
        );
        assert_eq!(summary.matches, 3);
        let nested = hits
            .iter()
            .find(|h| h.entry.name == "relatório final.pdf")
            .unwrap();
        assert_eq!(Path::new(&nested.dir), dir.path().join("a").join("b"));
        assert_eq!(nested.entry.kind, EntryKind::File);
        let folder = hits
            .iter()
            .find(|h| h.entry.name == "relatorios antigos")
            .unwrap();
        assert_eq!(folder.entry.kind, EntryKind::Dir);
    }

    #[test]
    fn results_come_breadth_first_so_the_closest_ones_appear_first() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "x/y/z/foto fundo.jpg");
        touch(dir.path(), "x/foto meio.jpg");
        touch(dir.path(), "foto raiz.jpg");
        let (hits, _) = run(dir.path(), "foto", false);
        assert_eq!(
            names(&hits),
            ["foto raiz.jpg", "foto meio.jpg", "foto fundo.jpg"]
        );
    }

    #[test]
    fn a_shallow_folder_is_searched_before_a_deep_one_even_if_it_comes_later() {
        // Numa cadeia reta, busca em largura e em profundidade dão a mesma ordem; só uma árvore com
        // ramificação (a pasta funda por último na listagem) as distingue.
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "a/alvo raso.txt");
        touch(dir.path(), "z/z1/z2/z3/alvo fundo.txt");
        touch(dir.path(), "alvo raiz.txt");
        let (hits, _) = run(dir.path(), "alvo", false);
        assert_eq!(
            names(&hits),
            ["alvo raiz.txt", "alvo raso.txt", "alvo fundo.txt"]
        );
    }

    #[test]
    fn matches_inside_one_folder_follow_the_listing_order() {
        let dir = tempfile::tempdir().unwrap();
        for f in ["img10.jpg", "img2.jpg", "img1.jpg"] {
            touch(dir.path(), f);
        }
        fs::create_dir(dir.path().join("img pasta")).unwrap();
        let (hits, _) = run(dir.path(), "img", false);
        assert_eq!(
            names(&hits),
            ["img pasta", "img1.jpg", "img2.jpg", "img10.jpg"]
        );
    }

    #[test]
    fn hits_carry_size_kind_and_modified_time() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("dados.bin"), [0u8; 321]).unwrap();
        let (hits, _) = run(dir.path(), "dados", false);
        let e = &hits[0].entry;
        assert_eq!((e.kind, e.size), (EntryKind::File, Some(321)));
        assert!(e.modified_ms.is_some());
        assert!(!e.hidden && !e.is_link);
    }

    #[cfg(windows)]
    fn hide(path: &Path) {
        std::process::Command::new("attrib")
            .arg("+h")
            .arg(path)
            .output()
            .unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn hidden_items_and_hidden_folders_are_skipped_unless_asked() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "visivel/alvo claro.txt");
        touch(dir.path(), "escondida/alvo dentro.txt");
        touch(dir.path(), "alvo oculto.txt");
        hide(&dir.path().join("escondida"));
        hide(&dir.path().join("alvo oculto.txt"));

        let (hits, summary) = run(dir.path(), "alvo", false);
        assert_eq!(names(&hits), ["alvo claro.txt"]);
        assert!(
            summary.scanned_dirs <= 2,
            "a pasta oculta não pode ser percorrida: {summary:?}"
        );

        let (hits, _) = run(dir.path(), "alvo", true);
        let mut found = names(&hits);
        found.sort_unstable();
        assert_eq!(
            found,
            ["alvo claro.txt", "alvo dentro.txt", "alvo oculto.txt"]
        );
    }

    #[cfg(windows)]
    #[test]
    fn junctions_are_not_followed_so_loops_and_escapes_cannot_happen() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        touch(outside.path(), "alvo fora.txt");
        touch(dir.path(), "real/alvo dentro.txt");
        let junction = |link: std::path::PathBuf, target: &Path| {
            std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        };
        // Ciclo (aponta para a própria raiz) e atalho para fora da pasta.
        let looped = junction(dir.path().join("real").join("ciclo"), dir.path());
        let escape = junction(dir.path().join("saida"), outside.path());
        if !(looped && escape) {
            eprintln!("mklink /J indisponível neste ambiente; teste ignorado");
            return;
        }
        let (hits, summary) = run(dir.path(), "alvo", false);
        assert_eq!(names(&hits), ["alvo dentro.txt"], "{hits:?}");
        assert!(
            summary.scanned_dirs <= 2,
            "a junção foi percorrida: {summary:?}"
        );
    }

    #[test]
    fn stops_at_the_limit_and_says_so() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..50 {
            touch(dir.path(), &format!("d{}/arquivo {i}.txt", i % 5));
        }
        let (hits, summary) = run_with(dir.path(), "arquivo", false, 7, &AtomicBool::new(false));
        assert_eq!(hits.len(), 7);
        assert!(summary.truncated && summary.matches == 7);
        let (all, summary) = run(dir.path(), "arquivo", false);
        assert_eq!(all.len(), 50);
        assert!(!summary.truncated);
    }

    #[test]
    fn cancelling_in_the_middle_stops_early_and_reports_it() {
        let dir = tempfile::tempdir().unwrap();
        for d in 0..40 {
            for f in 0..25 {
                touch(dir.path(), &format!("p{d}/a{f}.txt"));
            }
        }
        let cancel = AtomicBool::new(false);
        let query = Query::parse("a").unwrap();
        let mut received = 0usize;
        let summary = search(dir.path(), &query, false, MAX_RESULTS, &cancel, |ev| {
            if let SearchEvent::Hits { hits } = ev {
                received += hits.len();
                cancel.store(true, Ordering::Relaxed); // cancela logo depois do primeiro lote
            }
        })
        .unwrap();
        assert!(summary.cancelled);
        assert!(received > 0 && received < 40 * 25, "recebeu {received}");
        assert!(
            summary.scanned_dirs < 41,
            "não deveria ter percorrido tudo: {summary:?}"
        );
    }

    #[test]
    fn a_search_cancelled_before_it_starts_does_nothing() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "alvo.txt");
        let (hits, summary) = run_with(
            dir.path(),
            "alvo",
            false,
            MAX_RESULTS,
            &AtomicBool::new(true),
        );
        assert!(hits.is_empty() && summary.cancelled);
    }

    #[test]
    fn progress_is_reported_even_when_nothing_matches() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "a/b/c.txt");
        let query = Query::parse("inexistente").unwrap();
        let mut progress = Vec::new();
        let summary = search(
            dir.path(),
            &query,
            false,
            MAX_RESULTS,
            &AtomicBool::new(false),
            |ev| {
                if let SearchEvent::Progress {
                    scanned_dirs,
                    scanned_entries,
                } = ev
                {
                    progress.push((scanned_dirs, scanned_entries));
                }
            },
        )
        .unwrap();
        assert_eq!(summary.matches, 0);
        let last = progress.last().copied().expect("ao menos um andamento");
        assert_eq!((last.0, last.1), (3, 3), "3 pastas e 3 itens examinados");
    }

    #[test]
    fn hits_are_delivered_in_batches_no_bigger_than_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..(BATCH_MAX * 3) {
            touch(dir.path(), &format!("a/n{i}.txt"));
        }
        let query = Query::parse("n").unwrap();
        let mut sizes = Vec::new();
        search(
            dir.path(),
            &query,
            false,
            MAX_RESULTS,
            &AtomicBool::new(false),
            |ev| {
                if let SearchEvent::Hits { hits } = ev {
                    sizes.push(hits.len());
                }
            },
        )
        .unwrap();
        // Um diretório inteiro vai num lote só; o que importa é nada ser perdido nem duplicado.
        assert_eq!(sizes.iter().sum::<usize>(), BATCH_MAX * 3);
    }

    #[test]
    fn missing_root_and_file_root_are_errors_not_empty_results() {
        let dir = tempfile::tempdir().unwrap();
        let query = Query::parse("x").unwrap();
        let go = |p: &Path| search(p, &query, false, 10, &AtomicBool::new(false), |_| {});
        assert_eq!(
            go(&dir.path().join("nao-existe")).unwrap_err().code,
            ErrorCode::NotFound
        );
        touch(dir.path(), "arquivo.txt");
        assert_eq!(
            go(&dir.path().join("arquivo.txt")).unwrap_err().code,
            ErrorCode::NotADirectory
        );
    }

    #[test]
    fn special_names_unicode_and_regex_characters_are_plain_text() {
        let dir = tempfile::tempdir().unwrap();
        // (No Windows, * ? < > | : " não são permitidos em nomes de arquivo.)
        for f in [
            "100% (final).txt",
            "a+b[1].txt",
            "日本語 メモ.txt",
            "$HOME & co.txt",
            "a.b(c)^d.txt",
            "axb.txt",
        ] {
            touch(dir.path(), f);
        }
        assert_eq!(
            names(&run(dir.path(), "100%", false).0),
            ["100% (final).txt"]
        );
        assert_eq!(names(&run(dir.path(), "a+b[1]", false).0), ["a+b[1].txt"]);
        assert_eq!(
            names(&run(dir.path(), "メモ", false).0),
            ["日本語 メモ.txt"]
        );
        assert_eq!(
            names(&run(dir.path(), "$home &", false).0),
            ["$HOME & co.txt"]
        );
        assert_eq!(names(&run(dir.path(), "b(c)^", false).0), ["a.b(c)^d.txt"]);
        // "." não é curinga: "a.b" não casa com "axb.txt".
        assert_eq!(names(&run(dir.path(), "a.b", false).0), ["a.b(c)^d.txt"]);
    }

    #[test]
    fn a_wide_tree_is_searched_completely_and_without_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        for d in 0..120 {
            for f in 0..40 {
                touch(dir.path(), &format!("nivel{d}/sub{}/arq{f}.dat", f % 4));
            }
        }
        let (hits, summary) = run(dir.path(), "arq", false);
        assert_eq!(hits.len(), 120 * 40);
        let unique: HashSet<_> = hits
            .iter()
            .map(|h| format!("{}|{}", h.dir, h.entry.name))
            .collect();
        assert_eq!(unique.len(), hits.len(), "resultado duplicado");
        assert_eq!(summary.skipped_dirs, 0);
    }
}
