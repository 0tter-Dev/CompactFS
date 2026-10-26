//! Caminho digitado na barra de endereço: normaliza o texto e diz para onde ele aponta.
//!
//! Somente leitura: só consulta os metadados do caminho, sem listar, abrir nem liberar nada.

use std::{
    fs, io,
    path::{Component, Path, PathBuf},
};

use serde::Serialize;

use crate::browse::{classify, BrowseError, ErrorCode};

/// O que o texto digitado aponta.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Resolved {
    /// A tela "Este computador".
    Computer,
    Dir {
        path: String,
    },
    /// Um arquivo: a interface abre a pasta dele com o arquivo selecionado.
    File {
        path: String,
        parent: String,
        name: String,
    },
}

const COMPUTER_NAMES: [&str; 4] = ["este computador", "meu computador", "computador", "this pc"];

fn invalid(message: &str) -> BrowseError {
    BrowseError::new(ErrorCode::Other, message)
}

/// Tira espaços e um par de aspas em volta (o "Copiar como caminho" do Windows entrega aspas).
fn clean_input(input: &str) -> Result<&str, BrowseError> {
    if input.contains('\0') {
        return Err(invalid("O caminho tem um caractere inválido."));
    }
    let mut text = input.trim();
    if text.len() >= 2 && text.starts_with('"') && text.ends_with('"') {
        text = text[1..text.len() - 1].trim();
    }
    if text.is_empty() {
        return Err(invalid("Digite um caminho."));
    }
    Ok(text)
}

/// "D:" sozinho, no Windows, significa "pasta atual do disco D"; aqui significa a raiz do disco.
fn drive_letter_only(text: &str) -> Option<String> {
    let mut chars = text.chars();
    match (chars.next(), chars.next(), chars.next()) {
        (Some(letter), Some(':'), None) if letter.is_ascii_alphabetic() => {
            Some(format!("{}:\\", letter.to_ascii_uppercase()))
        }
        _ => None,
    }
}

/// Resolve `.` e `..` só pelo texto (sem tocar no disco) e junta separadores repetidos.
/// `..` acima da raiz é ignorado, como no Explorer.
fn lexical_clean(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                let has_name = matches!(out.components().next_back(), Some(Component::Normal(_)));
                if has_name {
                    out.pop();
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// "d:\x" vira "D:\x", igual ao que a listagem de discos mostra (só no Windows).
fn upper_drive_letter(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    let bytes = text.as_bytes();
    if cfg!(windows) && bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_lowercase() {
        return PathBuf::from(format!(
            "{}{}",
            bytes[0].to_ascii_uppercase() as char,
            &text[1..]
        ));
    }
    path
}

fn not_found() -> BrowseError {
    BrowseError::new(
        ErrorCode::NotFound,
        "Não encontrei esse caminho. Confira se está digitado certo e se o disco está conectado.",
    )
}

/// `base` é a pasta aberta no momento, usada só para caminhos relativos (como `..\outra`).
pub fn resolve(input: &str, base: Option<&Path>) -> Result<Resolved, BrowseError> {
    let text = clean_input(input)?;
    let lowered = text.to_lowercase();
    if COMPUTER_NAMES.contains(&lowered.as_str()) {
        return Ok(Resolved::Computer);
    }

    let text = if cfg!(windows) {
        drive_letter_only(text).unwrap_or_else(|| text.to_owned())
    } else {
        text.to_owned()
    };
    let typed = PathBuf::from(&text);

    let absolute = if typed.is_absolute() {
        typed
    } else if matches!(typed.components().next(), Some(Component::Prefix(_))) {
        // "C:pasta" (relativo à pasta atual de outro disco): ambíguo, melhor pedir o caminho inteiro.
        return Err(invalid(
            "Caminho incompleto. Digite o caminho completo, como C:\\Pasta.",
        ));
    } else if let Some(base) = base {
        base.join(typed)
    } else {
        return Err(invalid("Digite o caminho completo, como C:\\Pasta."));
    };
    let path = upper_drive_letter(lexical_clean(&absolute));

    let meta = fs::metadata(&path).map_err(|e| match e.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::InvalidInput | io::ErrorKind::InvalidFilename => {
            not_found()
        }
        _ => classify(&e),
    })?;

    let to_text = |p: &Path| p.to_string_lossy().into_owned();
    if meta.is_dir() {
        return Ok(Resolved::Dir {
            path: to_text(&path),
        });
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => Ok(Resolved::File {
            path: to_text(&path),
            parent: to_text(parent),
            name: name.to_string_lossy().into_owned(),
        }),
        _ => Err(not_found()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir_path(p: &Path) -> Resolved {
        Resolved::Dir {
            path: p.to_string_lossy().into_owned(),
        }
    }

    #[test]
    fn clean_input_trims_and_strips_one_pair_of_quotes() {
        assert_eq!(clean_input("  C:\\a  ").unwrap(), "C:\\a");
        assert_eq!(clean_input("\"C:\\a b\"").unwrap(), "C:\\a b");
        assert_eq!(clean_input(" \" C:\\a \" ").unwrap(), "C:\\a");
        // Aspas só de um lado ou aspas duplas dentro do texto não são tocadas.
        assert_eq!(clean_input("\"C:\\a").unwrap(), "\"C:\\a");
    }

    #[test]
    fn clean_input_rejects_empty_and_nul() {
        for empty in ["", "   ", "\"\"", "\" \""] {
            let err = clean_input(empty).unwrap_err();
            assert!(err.message.contains("Digite um caminho"), "{empty:?}");
        }
        assert!(clean_input("a\0b")
            .unwrap_err()
            .message
            .contains("inválido"));
    }

    #[test]
    fn drive_letter_only_matches_just_a_letter_and_colon() {
        assert_eq!(drive_letter_only("d:"), Some("D:\\".to_owned()));
        assert_eq!(drive_letter_only("E:"), Some("E:\\".to_owned()));
        assert_eq!(drive_letter_only("E:\\"), None);
        assert_eq!(drive_letter_only("E:x"), None);
        assert_eq!(drive_letter_only("1:"), None);
        assert_eq!(drive_letter_only("EE:"), None);
        assert_eq!(drive_letter_only(""), None);
    }

    #[test]
    fn lexical_clean_resolves_dots_and_ignores_parents_above_the_root() {
        let root = if cfg!(windows) { "C:\\" } else { "/" };
        let join = |parts: &[&str]| {
            let mut p = PathBuf::from(root);
            p.extend(parts);
            p
        };
        assert_eq!(
            lexical_clean(&join(&["a", ".", "b", "..", "c"])),
            join(&["a", "c"])
        );
        assert_eq!(lexical_clean(&join(&["..", "..", "a"])), join(&["a"]));
        assert_eq!(lexical_clean(&join(&[])), PathBuf::from(root));
        assert_eq!(lexical_clean(&join(&["a", "", "b"])), join(&["a", "b"]));
    }

    #[test]
    fn computer_names_are_recognized_in_any_case() {
        for name in [
            "Este computador",
            "  ESTE COMPUTADOR ",
            "this pc",
            "\"Meu Computador\"",
        ] {
            assert_eq!(resolve(name, None).unwrap(), Resolved::Computer, "{name}");
        }
    }

    #[test]
    fn resolves_an_existing_folder_as_typed_and_with_quotes() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("Minha Pasta");
        fs::create_dir(&sub).unwrap();
        let typed = sub.to_string_lossy().into_owned();
        assert_eq!(resolve(&typed, None).unwrap(), dir_path(&sub));
        assert_eq!(
            resolve(&format!("\"{typed}\""), None).unwrap(),
            dir_path(&sub)
        );
        let sep = std::path::MAIN_SEPARATOR;
        assert_eq!(
            resolve(&format!("{typed}{sep}"), None).unwrap(),
            dir_path(&sub)
        );
    }

    #[test]
    fn resolves_a_file_to_its_folder_and_name() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nota.txt");
        fs::write(&file, b"x").unwrap();
        let resolved = resolve(&file.to_string_lossy(), None).unwrap();
        assert_eq!(
            resolved,
            Resolved::File {
                path: file.to_string_lossy().into_owned(),
                parent: dir.path().to_string_lossy().into_owned(),
                name: "nota.txt".to_owned(),
            }
        );
    }

    #[test]
    fn missing_paths_are_not_found_with_a_clear_message() {
        let dir = tempfile::tempdir().unwrap();
        let err = resolve(&dir.path().join("nao-existe").to_string_lossy(), None).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
        assert!(err.message.contains("Não encontrei esse caminho"));
    }

    #[test]
    fn relative_paths_use_the_open_folder_and_dotdot_goes_up() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        fs::create_dir(&a).unwrap();
        fs::create_dir(&b).unwrap();
        assert_eq!(resolve("..", Some(&a)).unwrap(), dir_path(dir.path()));
        let sep = std::path::MAIN_SEPARATOR;
        assert_eq!(
            resolve(&format!("..{sep}b"), Some(&a)).unwrap(),
            dir_path(&b)
        );
        assert_eq!(resolve("b", Some(dir.path())).unwrap(), dir_path(&b));
        assert_eq!(resolve(".", Some(&a)).unwrap(), dir_path(&a));
    }

    #[test]
    fn relative_paths_without_an_open_folder_ask_for_the_full_path() {
        let err = resolve("pasta", None).unwrap_err();
        assert!(err.message.contains("caminho completo"));
    }

    #[cfg(windows)]
    mod windows {
        use super::*;

        fn temp_drive() -> char {
            std::env::temp_dir()
                .to_string_lossy()
                .chars()
                .next()
                .unwrap()
                .to_ascii_uppercase()
        }

        #[test]
        fn a_bare_drive_letter_means_the_drive_root_in_any_case() {
            let letter = temp_drive();
            let expected = Resolved::Dir {
                path: format!("{letter}:\\"),
            };
            assert_eq!(resolve(&format!("{letter}:"), None).unwrap(), expected);
            let lower = letter.to_ascii_lowercase();
            assert_eq!(resolve(&format!("{lower}:"), None).unwrap(), expected);
            assert_eq!(resolve(&format!("{lower}:/"), None).unwrap(), expected);
        }

        #[test]
        fn forward_slashes_and_repeated_separators_are_accepted() {
            let dir = tempfile::tempdir().unwrap();
            let sub = dir.path().join("pasta");
            fs::create_dir(&sub).unwrap();
            let messy = sub.to_string_lossy().replace('\\', "//");
            assert_eq!(resolve(&messy, None).unwrap(), dir_path(&sub));
        }

        #[test]
        fn drive_relative_paths_are_rejected_as_incomplete() {
            let letter = temp_drive();
            let err = resolve(&format!("{letter}:pasta"), None).unwrap_err();
            assert!(err.message.contains("incompleto"));
        }

        #[test]
        fn characters_windows_forbids_in_names_are_just_not_found() {
            let dir = tempfile::tempdir().unwrap();
            let bad = format!("{}\\a<b>?.txt", dir.path().display());
            assert_eq!(resolve(&bad, None).unwrap_err().code, ErrorCode::NotFound);
        }
    }
}
