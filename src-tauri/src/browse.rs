//! Listagem somente leitura de pastas, com ordenação e erros pensados para discos portáteis.
//!
//! Nada aqui escreve no disco. Em Windows o `read_dir` já traz tamanho e data de cada entrada
//! (sem uma chamada extra por arquivo), o que mantém a listagem rápida mesmo em pastas grandes.

use std::{
    cmp::Ordering,
    fs, io,
    path::Path,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use crate::drives;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Dir,
    File,
    /// Qualquer outra coisa (dispositivo, link quebrado, etc.).
    Other,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub kind: EntryKind,
    /// Tamanho em bytes. Só para arquivos.
    pub size: Option<u64>,
    /// Última modificação, em milissegundos desde 1970-01-01 UTC.
    pub modified_ms: Option<i64>,
    /// Oculto ou de sistema (atributos do Windows) ou nome começando com ponto (demais SOs).
    pub hidden: bool,
    /// Link simbólico ou junção; `kind` já reflete o destino.
    pub is_link: bool,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Crumb {
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub path: String,
    /// `None` na raiz de um disco: o chamador volta para a lista de discos.
    pub parent: Option<String>,
    pub breadcrumbs: Vec<Crumb>,
    pub separator: &'static str,
    pub entries: Vec<Entry>,
    /// Entradas que não puderam ser lidas e ficaram de fora.
    pub skipped: u32,
    /// Tempo gasto no núcleo para listar e ordenar.
    pub elapsed_ms: u64,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    NotFound,
    AccessDenied,
    NotADirectory,
    /// O disco foi removido, está dormindo ou não responde.
    DeviceUnavailable,
    Other,
}

#[derive(Serialize, Debug)]
pub struct BrowseError {
    pub code: ErrorCode,
    pub message: String,
}

impl BrowseError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Códigos do Windows que indicam disco ausente ou sem resposta
/// (NOT_READY 21, DEV_NOT_EXIST 55, NO_MEDIA_IN_DRIVE 1112, IO_DEVICE 1117, DEVICE_NOT_CONNECTED 1167).
const DEVICE_UNAVAILABLE_OS_ERRORS: [i32; 5] = [21, 55, 1112, 1117, 1167];

pub fn classify(error: &io::Error) -> BrowseError {
    if let Some(code) = error.raw_os_error() {
        if DEVICE_UNAVAILABLE_OS_ERRORS.contains(&code) {
            return BrowseError::new(
                ErrorCode::DeviceUnavailable,
                "O disco não está disponível. Ele pode ter sido desconectado ou está sem resposta.",
            );
        }
    }
    // Pasta inexistente, sem permissão e "não é uma pasta" (ERROR_DIRECTORY, 267) já chegam
    // como `ErrorKind` próprio pelo `std`.
    match error.kind() {
        io::ErrorKind::NotFound => BrowseError::new(
            ErrorCode::NotFound,
            "A pasta não foi encontrada. Ela pode ter sido movida, apagada ou o disco foi desconectado.",
        ),
        io::ErrorKind::PermissionDenied => BrowseError::new(
            ErrorCode::AccessDenied,
            "Sem permissão para abrir esta pasta.",
        ),
        io::ErrorKind::NotADirectory => {
            BrowseError::new(ErrorCode::NotADirectory, "O caminho não é uma pasta.")
        }
        _ => BrowseError::new(
            ErrorCode::Other,
            format!("Não foi possível ler a pasta: {error}"),
        ),
    }
}

/// Comparação "natural" sem diferenciar maiúsculas: `arquivo2` vem antes de `arquivo10`.
/// Desempata pela comparação exata para a ordem ser determinística.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ca), Some(cb)) if ca.is_ascii_digit() && cb.is_ascii_digit() => {
                let na = take_digits(&mut ai);
                let nb = take_digits(&mut bi);
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let ord = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(ca), Some(cb)) => {
                let (la, lb) = (fold(ca), fold(cb));
                if la != lb {
                    return la.cmp(&lb);
                }
                ai.next();
                bi.next();
            }
        }
    }
}

fn take_digits(it: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut digits = String::new();
    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
        digits.push(c);
        it.next();
    }
    digits
}

fn fold(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

fn modified_ms(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(d) => i64::try_from(d.as_millis()).unwrap_or(i64::MAX),
        Err(e) => -i64::try_from(e.duration().as_millis()).unwrap_or(i64::MAX),
    }
}

#[cfg(windows)]
fn is_hidden(_name: &str, meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    meta.file_attributes() & (HIDDEN | SYSTEM) != 0
}

#[cfg(not(windows))]
fn is_hidden(name: &str, _meta: &fs::Metadata) -> bool {
    name.starts_with('.')
}

/// Se a entrada é oculta, sem ler os metadados completos onde isso custa um acesso ao disco.
/// No Windows os atributos já vêm com a listagem; nos outros sistemas basta o nome.
#[cfg(windows)]
pub(crate) fn is_hidden_entry(dir_entry: &fs::DirEntry, name: &str) -> bool {
    dir_entry
        .metadata()
        .ok()
        .is_some_and(|m| is_hidden(name, &m))
}

#[cfg(not(windows))]
pub(crate) fn is_hidden_entry(_dir_entry: &fs::DirEntry, name: &str) -> bool {
    name.starts_with('.')
}

pub(crate) fn read_entry(dir_entry: &fs::DirEntry) -> Option<Entry> {
    let name = dir_entry.file_name().to_string_lossy().into_owned();
    let file_type = dir_entry.file_type().ok()?;
    let meta = dir_entry.metadata().ok();
    let is_link = file_type.is_symlink();

    // Em links, `kind` segue o destino (uma junção para pasta deve ser navegável).
    let target_meta = if is_link {
        fs::metadata(dir_entry.path()).ok()
    } else {
        None
    };
    let effective = target_meta.as_ref().or(meta.as_ref());
    let kind = match effective {
        Some(m) if m.is_dir() => EntryKind::Dir,
        Some(m) if m.is_file() => EntryKind::File,
        _ if !is_link && file_type.is_dir() => EntryKind::Dir,
        _ if !is_link && file_type.is_file() => EntryKind::File,
        _ => EntryKind::Other,
    };
    let size = (kind == EntryKind::File)
        .then(|| effective.map(fs::Metadata::len))
        .flatten();
    let hidden = meta.as_ref().is_some_and(|m| is_hidden(&name, m));
    let modified_ms = effective.and_then(|m| m.modified().ok()).map(modified_ms);

    Some(Entry {
        name,
        kind,
        size,
        modified_ms,
        hidden,
        is_link,
    })
}

pub(crate) fn sort_entries(entries: &mut [Entry]) {
    entries.sort_by(|a, b| {
        let a_dir = a.kind == EntryKind::Dir;
        let b_dir = b.kind == EntryKind::Dir;
        b_dir
            .cmp(&a_dir)
            .then_with(|| natural_cmp(&a.name, &b.name))
    });
}

/// Trilha de navegação: um item por nível, da raiz do disco até a pasta atual.
/// No Android a trilha começa no armazenamento ("Armazenamento interno"), não em `/storage/emulated/0`.
pub fn breadcrumbs(path: &Path) -> Vec<Crumb> {
    match drives::volume_root(path) {
        Some((root, label)) => breadcrumbs_under(path, &root, &label),
        None => breadcrumbs_plain(path),
    }
}

/// Trilha que começa na raiz de um armazenamento, com o nome dele no primeiro item.
fn breadcrumbs_under(path: &Path, root: &Path, label: &str) -> Vec<Crumb> {
    let mut crumbs = vec![Crumb {
        name: label.to_owned(),
        path: root.to_string_lossy().into_owned(),
    }];
    let mut current = root.to_path_buf();
    if let Ok(rest) = path.strip_prefix(root) {
        for part in rest.components() {
            current.push(part);
            crumbs.push(Crumb {
                name: part.as_os_str().to_string_lossy().into_owned(),
                path: current.to_string_lossy().into_owned(),
            });
        }
    }
    crumbs
}

fn breadcrumbs_plain(path: &Path) -> Vec<Crumb> {
    let mut ancestors: Vec<&Path> = path.ancestors().collect();
    ancestors.reverse();
    ancestors
        .into_iter()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| {
            let name = match p.file_name() {
                Some(n) => n.to_string_lossy().into_owned(),
                // Raiz do disco ("D:\"): mostra "D:".
                None => p.to_string_lossy().trim_end_matches(['\\', '/']).to_owned(),
            };
            let name = if name.is_empty() {
                "/".to_owned()
            } else {
                name
            };
            Crumb {
                name,
                path: p.to_string_lossy().into_owned(),
            }
        })
        .collect()
}

pub fn list_dir(path: &Path) -> Result<Listing, BrowseError> {
    let started = Instant::now();
    let read = fs::read_dir(path).map_err(|e| classify(&e))?;

    let mut entries = Vec::new();
    let mut skipped = 0u32;
    for item in read {
        match item.ok().as_ref().and_then(read_entry) {
            Some(entry) => entries.push(entry),
            None => skipped += 1,
        }
    }
    sort_entries(&mut entries);

    // A raiz de um armazenamento do Android é o topo: subir daqui volta para "Este computador".
    let is_volume_root = drives::volume_root(path).is_some_and(|(root, _)| root == path);
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty() && !is_volume_root)
        .map(|p| p.to_string_lossy().into_owned());

    Ok(Listing {
        path: path.to_string_lossy().into_owned(),
        parent,
        breadcrumbs: breadcrumbs(path),
        separator: std::path::MAIN_SEPARATOR_STR,
        entries,
        skipped,
        elapsed_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    fn names(listing: &Listing) -> Vec<&str> {
        listing.entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn natural_order_compares_digit_runs_as_numbers() {
        assert_eq!(natural_cmp("arquivo2", "arquivo10"), Ordering::Less);
        assert_eq!(natural_cmp("arquivo10", "arquivo2"), Ordering::Greater);
        // Mesmo valor numérico: desempata pela comparação exata, de forma estável.
        assert_eq!(natural_cmp("img001", "img1"), Ordering::Less);
        assert_eq!(natural_cmp("img1", "img001"), Ordering::Greater);
        assert_eq!(natural_cmp("a9", "a010"), Ordering::Less);
    }

    #[test]
    fn natural_order_ignores_case_but_is_deterministic() {
        assert_eq!(natural_cmp("Alpha", "beta"), Ordering::Less);
        assert_eq!(natural_cmp("beta", "Alpha"), Ordering::Greater);
        // Maiúscula não pode ordenar antes de minúscula só pelo código do caractere.
        assert_eq!(natural_cmp("apple", "Banana"), Ordering::Less);
        assert_eq!(natural_cmp("Banana", "apple"), Ordering::Greater);
        // Iguais ignorando maiúsculas: desempata pela comparação exata.
        assert_ne!(natural_cmp("abc", "ABC"), Ordering::Equal);
        assert_eq!(natural_cmp("abc", "abc"), Ordering::Equal);
    }

    #[test]
    fn natural_order_handles_prefixes_empty_and_huge_numbers() {
        assert_eq!(natural_cmp("a", "ab"), Ordering::Less);
        assert_eq!(natural_cmp("", "a"), Ordering::Less);
        // Mais dígitos do que cabe em qualquer inteiro: não pode estourar.
        let big = format!("x{}", "9".repeat(60));
        let bigger = format!("x1{}", "0".repeat(60));
        assert_eq!(natural_cmp(&big, &bigger), Ordering::Less);
    }

    #[test]
    fn lists_folders_first_then_files_in_natural_order() {
        let dir = tempfile::tempdir().unwrap();
        for f in ["b10.txt", "b2.txt", "A.txt"] {
            File::create(dir.path().join(f)).unwrap();
        }
        for d in ["zeta", "Alfa"] {
            fs::create_dir(dir.path().join(d)).unwrap();
        }
        let listing = list_dir(dir.path()).unwrap();
        assert_eq!(
            names(&listing),
            ["Alfa", "zeta", "A.txt", "b2.txt", "b10.txt"]
        );
        assert_eq!(listing.skipped, 0);
    }

    #[test]
    fn reports_kind_size_and_modified_time() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("dados.bin"), [0u8; 1234]).unwrap();
        fs::create_dir(dir.path().join("pasta")).unwrap();
        let listing = list_dir(dir.path()).unwrap();

        let folder = &listing.entries[0];
        assert_eq!(
            (folder.name.as_str(), folder.kind),
            ("pasta", EntryKind::Dir)
        );
        assert_eq!(folder.size, None);

        let file = &listing.entries[1];
        assert_eq!(
            (file.name.as_str(), file.kind),
            ("dados.bin", EntryKind::File)
        );
        assert_eq!(file.size, Some(1234));
        let modified = file.modified_ms.expect("data de modificação");
        let now = modified_ms(SystemTime::now());
        assert!(
            (now - 60_000..=now + 60_000).contains(&modified),
            "{modified} vs {now}"
        );
    }

    #[test]
    fn empty_folder_lists_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let listing = list_dir(dir.path()).unwrap();
        assert!(listing.entries.is_empty());
        assert_eq!(listing.skipped, 0);
    }

    #[test]
    fn missing_path_is_reported_as_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let err = list_dir(&dir.path().join("nao-existe")).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
        assert!(err.message.contains("não foi encontrada"));
    }

    #[test]
    fn file_path_is_reported_as_not_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("arquivo.txt");
        File::create(&file).unwrap();
        let err = list_dir(&file).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotADirectory);
    }

    #[test]
    fn os_error_codes_are_classified_for_users() {
        let denied = classify(&io::Error::from(io::ErrorKind::PermissionDenied));
        assert_eq!(denied.code, ErrorCode::AccessDenied);
        for raw in DEVICE_UNAVAILABLE_OS_ERRORS {
            let err = classify(&io::Error::from_raw_os_error(raw));
            assert_eq!(err.code, ErrorCode::DeviceUnavailable, "código {raw}");
            assert!(err.message.contains("desconectado"));
        }
        let other = classify(&io::Error::other("falha qualquer"));
        assert_eq!(other.code, ErrorCode::Other);
    }

    #[test]
    fn hidden_entries_are_flagged() {
        let dir = tempfile::tempdir().unwrap();
        File::create(dir.path().join("visivel.txt")).unwrap();
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .attributes(0x2) // FILE_ATTRIBUTE_HIDDEN
                .open(dir.path().join("oculto.txt"))
                .unwrap();
        }
        #[cfg(not(windows))]
        File::create(dir.path().join(".oculto.txt")).unwrap();

        let listing = list_dir(dir.path()).unwrap();
        let hidden: Vec<_> = listing.entries.iter().filter(|e| e.hidden).collect();
        assert_eq!(hidden.len(), 1);
        assert!(hidden[0].name.contains("oculto"));
        assert!(!listing
            .entries
            .iter()
            .any(|e| e.name == "visivel.txt" && e.hidden));
    }

    #[cfg(windows)]
    #[test]
    fn system_files_are_flagged_as_hidden_too() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .attributes(0x4) // FILE_ATTRIBUTE_SYSTEM
            .open(dir.path().join("sistema.sys"))
            .unwrap();
        File::create(dir.path().join("normal.txt")).unwrap();
        let listing = list_dir(dir.path()).unwrap();
        let find = |n: &str| listing.entries.iter().find(|e| e.name == n).unwrap();
        assert!(find("sistema.sys").hidden);
        assert!(!find("normal.txt").hidden);
    }

    #[test]
    fn unicode_and_special_names_are_preserved() {
        // Caracteres que costumam quebrar interfaces web ou ferramentas de linha de comando.
        // (No Windows, `<`, `>` e `"` não são permitidos em nomes de arquivo.)
        const NAMES: [&str; 5] = [
            "ação café.txt",
            "&lt;b&gt;.txt",
            "a'b.txt",
            "100%.txt",
            "日本語.md",
        ];
        let dir = tempfile::tempdir().unwrap();
        for f in NAMES {
            File::create(dir.path().join(f)).unwrap();
        }
        let listing = list_dir(dir.path()).unwrap();
        let got = names(&listing);
        for f in NAMES {
            assert!(got.contains(&f), "faltou {f}: {got:?}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn junction_to_a_folder_is_navigable_and_broken_junction_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("destino");
        fs::create_dir(&target).unwrap();
        let link = dir.path().join("atalho");
        let ok = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&target)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !ok {
            eprintln!("mklink /J indisponível neste ambiente; teste ignorado");
            return;
        }
        let broken = dir.path().join("quebrado");
        let gone = dir.path().join("sumiu");
        fs::create_dir(&gone).unwrap();
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&broken)
            .arg(&gone)
            .output()
            .unwrap();
        fs::remove_dir(&gone).unwrap();

        let listing = list_dir(dir.path()).unwrap();
        let find = |n: &str| listing.entries.iter().find(|e| e.name == n).unwrap();
        assert_eq!(find("atalho").kind, EntryKind::Dir);
        assert!(find("atalho").is_link);
        assert_eq!(find("destino").kind, EntryKind::Dir);
        assert!(!find("destino").is_link);
        assert_eq!(find("quebrado").kind, EntryKind::Other);
        assert!(find("quebrado").is_link);
    }

    #[test]
    fn large_folder_is_listed_completely_and_sorted() {
        let dir = tempfile::tempdir().unwrap();
        let total = 20_000usize;
        for i in 0..total {
            File::create(dir.path().join(format!("f{i}.dat"))).unwrap();
        }
        let listing = list_dir(dir.path()).unwrap();
        assert_eq!(listing.entries.len(), total);
        assert_eq!(listing.entries[0].name, "f0.dat");
        assert_eq!(
            listing.entries[total - 1].name,
            format!("f{}.dat", total - 1)
        );
        assert!(listing
            .entries
            .windows(2)
            .all(|w| natural_cmp(&w[0].name, &w[1].name) != Ordering::Greater));
    }

    #[cfg(windows)]
    #[test]
    fn breadcrumbs_and_parent_follow_the_path_levels() {
        let crumbs = breadcrumbs(Path::new(r"D:\fotos\2024"));
        let pairs: Vec<(&str, &str)> = crumbs
            .iter()
            .map(|c| (c.name.as_str(), c.path.as_str()))
            .collect();
        assert_eq!(
            pairs,
            [
                ("D:", r"D:\"),
                ("fotos", r"D:\fotos"),
                ("2024", r"D:\fotos\2024")
            ]
        );
        let root = breadcrumbs(Path::new(r"D:\"));
        assert_eq!(root.len(), 1);
        assert_eq!(root[0].name, "D:");
    }

    #[test]
    fn breadcrumbs_under_a_storage_start_at_its_name() {
        let root = Path::new("/storage/emulated/0");
        let path = root.join("DCIM").join("Camera");
        let crumbs = breadcrumbs_under(&path, root, "Armazenamento interno");
        let names: Vec<&str> = crumbs.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["Armazenamento interno", "DCIM", "Camera"]);
        let expected = [
            root.to_path_buf(),
            root.join("DCIM"),
            root.join("DCIM").join("Camera"),
        ];
        for (crumb, want) in crumbs.iter().zip(expected) {
            assert_eq!(Path::new(&crumb.path), want);
        }
    }

    #[test]
    fn breadcrumbs_under_the_storage_root_have_a_single_item() {
        let root = Path::new("/storage/1A2B-3C4D");
        let crumbs = breadcrumbs_under(root, root, "Armazenamento removível 1A2B-3C4D");
        assert_eq!(crumbs.len(), 1);
        assert_eq!(Path::new(&crumbs[0].path), root);
    }

    #[test]
    fn listing_has_a_parent_except_at_the_filesystem_root() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        let listing = list_dir(&sub).unwrap();
        assert_eq!(
            listing.parent.as_deref(),
            Some(dir.path().to_string_lossy().as_ref())
        );
        let root = dir.path().ancestors().last().unwrap();
        assert!(root.parent().is_none());
        assert_eq!(
            list_dir(root)
                .map(|l| l.parent)
                .unwrap_or(Some("erro".into())),
            None
        );
    }
}
