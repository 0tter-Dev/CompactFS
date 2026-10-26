//! Apoio aos visualizadores: leitura de texto (com detecção de codificação) e "abrir no app padrão".
//!
//! Tudo aqui é somente leitura. Abrir no app padrão nunca executa programas, scripts, atalhos nem
//! documentos com macros: esses tipos são bloqueados (ver `is_blocked_for_open`).

use std::{
    fs::{self, File},
    io::{self, Read},
    path::Path,
};

use serde::Serialize;

/// Só os primeiros bytes de um texto são lidos: um log de gigabytes não pode travar a interface.
pub const MAX_TEXT_BYTES: u64 = 1024 * 1024;
/// Quantos bytes iniciais são examinados para decidir se o arquivo é binário.
const BINARY_SNIFF_BYTES: usize = 8192;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ViewErrorCode {
    NotFound,
    AccessDenied,
    NotAFile,
    /// Arquivo binário: não faz sentido mostrar como texto.
    Binary,
    /// Tipo que o app se recusa a abrir (executáveis, scripts, atalhos, macros).
    Blocked,
    Other,
}

#[derive(Serialize, Debug)]
pub struct ViewError {
    pub code: ViewErrorCode,
    pub message: String,
}

impl ViewError {
    pub fn new(code: ViewErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

fn from_io(error: &io::Error) -> ViewError {
    match error.kind() {
        io::ErrorKind::NotFound => ViewError::new(
            ViewErrorCode::NotFound,
            "O arquivo não foi encontrado. Ele pode ter sido movido, apagado ou o disco foi desconectado.",
        ),
        io::ErrorKind::PermissionDenied => {
            ViewError::new(ViewErrorCode::AccessDenied, "Sem permissão para abrir este arquivo.")
        }
        _ => ViewError::new(ViewErrorCode::Other, format!("Não foi possível ler o arquivo: {error}")),
    }
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextContent {
    pub text: String,
    pub encoding: &'static str,
    /// O arquivo é maior que o limite e só o começo foi lido.
    pub truncated: bool,
    pub total_bytes: u64,
}

/// Windows-1252 para 0x80..=0x9F (o resto coincide com Latin-1). É a codificação "ANSI" de textos
/// antigos em português: `ação` salvo em ANSI não é UTF-8 válido.
const CP1252_HIGH: [char; 32] = [
    '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž', '\u{8F}',
    '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9D}', 'ž', 'Ÿ',
];

fn decode_cp1252(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&b| match b {
            0x80..=0x9F => CP1252_HIGH[(b - 0x80) as usize],
            _ => char::from(b),
        })
        .collect()
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    // Um byte sobrando no fim (leitura cortada no meio de uma unidade) é descartado.
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&pair| {
            if little_endian {
                u16::from_le_bytes(pair)
            } else {
                u16::from_be_bytes(pair)
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

/// Decodifica `bytes` como texto. `truncated` indica que o fim foi cortado (pode haver um caractere
/// UTF-8 incompleto no final, que é descartado em vez de virar lixo).
pub fn decode_text(bytes: &[u8], truncated: bool) -> Result<(String, &'static str), ViewError> {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return decode_utf8_or_ansi(rest, truncated);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return Ok((decode_utf16(rest, true), "utf-16le"));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return Ok((decode_utf16(rest, false), "utf-16be"));
    }
    if bytes.iter().take(BINARY_SNIFF_BYTES).any(|&b| b == 0) {
        return Err(ViewError::new(
            ViewErrorCode::Binary,
            "Este arquivo é binário e não pode ser mostrado como texto.",
        ));
    }
    decode_utf8_or_ansi(bytes, truncated)
}

fn decode_utf8_or_ansi(bytes: &[u8], truncated: bool) -> Result<(String, &'static str), ViewError> {
    match std::str::from_utf8(bytes) {
        Ok(text) => Ok((text.to_owned(), "utf-8")),
        // Cortado no meio de um caractere de vários bytes: usa só a parte válida.
        Err(e) if truncated && e.error_len().is_none() => {
            let valid = std::str::from_utf8(&bytes[..e.valid_up_to()]).unwrap_or_default();
            Ok((valid.to_owned(), "utf-8"))
        }
        Err(_) => Ok((decode_cp1252(bytes), "windows-1252")),
    }
}

/// Confirma que `path` existe e é um arquivo comum; devolve o tamanho.
pub fn ensure_file(path: &Path) -> Result<u64, ViewError> {
    let meta = fs::metadata(path).map_err(|e| from_io(&e))?;
    if !meta.is_file() {
        return Err(ViewError::new(
            ViewErrorCode::NotAFile,
            "O caminho não é um arquivo.",
        ));
    }
    Ok(meta.len())
}

pub fn read_text(path: &Path) -> Result<TextContent, ViewError> {
    let total_bytes = ensure_file(path)?;
    let mut buf = Vec::new();
    File::open(path)
        .and_then(|f| f.take(MAX_TEXT_BYTES).read_to_end(&mut buf))
        .map_err(|e| from_io(&e))?;
    let truncated = total_bytes > MAX_TEXT_BYTES;
    let (text, encoding) = decode_text(&buf, truncated)?;
    Ok(TextContent {
        text,
        encoding,
        truncated,
        total_bytes,
    })
}

/// Extensões que o app nunca abre no app padrão: programas, scripts, atalhos, instaladores e
/// documentos do Office com macros. Abrir um deles equivaleria a executar código do disco.
const BLOCKED_EXTENSIONS: &[&str] = &[
    // programas e bibliotecas
    "exe",
    "com",
    "scr",
    "pif",
    "dll",
    "sys",
    "cpl",
    "msi",
    "msp",
    "mst",
    "appx",
    "msix",
    "appxbundle",
    "application",
    "gadget",
    "jar",
    "apk",
    "apks",
    "xapk",
    "apkm",
    // scripts e shells
    "bat",
    "cmd",
    "ps1",
    "psm1",
    "psd1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "ws",
    "hta",
    "sh",
    // atalhos, arquivos de configuração e de sistema que disparam ações
    "lnk",
    "url",
    "scf",
    "inf",
    "reg",
    "chm",
    "library-ms",
    "searchconnector-ms",
    "settingcontent-ms",
    // Office: documentos com macros e add-ins (alguns, como .xll e .wll, são DLLs)
    "docm",
    "dotm",
    "xlsm",
    "xlsb",
    "xltm",
    "xlam",
    "xla",
    "xll",
    "wll",
    "pptm",
    "potm",
    "ppam",
    "ppsm",
    "ppa",
    "sldm",
];

/// Decide se um arquivo não pode ser aberto no app padrão.
///
/// O Windows ignora pontos e espaços no fim do nome (`virus.exe.` e `virus.exe ` são o mesmo
/// arquivo) e aceita fluxos alternativos (`a.txt:malware.exe`), então o nome é normalizado antes
/// de olhar a extensão. Sem extensão, também bloqueia: não dá para saber o que o sistema faria.
pub fn is_blocked_for_open(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    // Fluxo alternativo de dados (NTFS): "arquivo.txt:fluxo".
    if name.contains(':') {
        return true;
    }
    let name = name.trim_end_matches(['.', ' ']);
    match name.rfind('.') {
        // `.exe` (arquivo só com extensão) também tem extensão para o Windows.
        Some(dot) => BLOCKED_EXTENSIONS.contains(&name[dot + 1..].to_ascii_lowercase().as_str()),
        None => true,
    }
}

/// Verificações antes de abrir no app padrão: é um arquivo e não é de um tipo bloqueado.
pub fn check_openable(path: &Path) -> Result<(), ViewError> {
    ensure_file(path)?;
    if is_blocked_for_open(path) {
        return Err(ViewError::new(
            ViewErrorCode::Blocked,
            "Este tipo de arquivo (programa, script, atalho ou documento com macros) não é aberto pelo CompactFS.",
        ));
    }
    Ok(())
}

/// Abre o arquivo no app padrão do sistema, sem confirmação (como um duplo clique no Explorer),
/// exceto para os tipos bloqueados. No Android quem abre é o plugin em Kotlin (ver `storage`).
#[cfg_attr(target_os = "android", allow(dead_code))]
pub fn open_default(path: &Path) -> Result<(), ViewError> {
    check_openable(path)?;
    platform::open(path)
}

#[cfg(windows)]
mod platform {
    use super::{ViewError, ViewErrorCode};
    use std::path::Path;
    use windows::core::{w, HSTRING};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    pub fn open(path: &Path) -> Result<(), ViewError> {
        let file = HSTRING::from(path.to_string_lossy().as_ref());
        // SAFETY: `file` vive durante a chamada; os demais argumentos são nulos ou literais.
        let result = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                &file,
                windows::core::PCWSTR::null(),
                windows::core::PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        // Documentação: valores acima de 32 indicam sucesso.
        if result.0 as usize > 32 {
            Ok(())
        } else {
            Err(ViewError::new(
                ViewErrorCode::Other,
                "O Windows não encontrou um programa para abrir este tipo de arquivo.",
            ))
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{ViewError, ViewErrorCode};
    use std::path::Path;

    #[cfg_attr(target_os = "android", allow(dead_code))]
    pub fn open(_path: &Path) -> Result<(), ViewError> {
        Err(ViewError::new(
            ViewErrorCode::Other,
            "Abrir no app padrão ainda não está disponível neste sistema.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn utf16le(s: &str, bom: bool) -> Vec<u8> {
        let mut v = if bom { vec![0xFF, 0xFE] } else { vec![] };
        v.extend(s.encode_utf16().flat_map(|u| u.to_le_bytes()));
        v
    }

    #[test]
    fn utf8_text_is_returned_as_is() {
        let (text, enc) = decode_text("olá, ação ✓".as_bytes(), false).unwrap();
        assert_eq!((text.as_str(), enc), ("olá, ação ✓", "utf-8"));
    }

    #[test]
    fn utf8_bom_is_removed() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend("texto".as_bytes());
        let (text, enc) = decode_text(&bytes, false).unwrap();
        assert_eq!((text.as_str(), enc), ("texto", "utf-8"));
    }

    #[test]
    fn utf16_with_bom_is_decoded_in_both_byte_orders() {
        let (le, enc) = decode_text(&utf16le("ação 日本", true), false).unwrap();
        assert_eq!((le.as_str(), enc), ("ação 日本", "utf-16le"));
        let mut be = vec![0xFE, 0xFF];
        be.extend("ação".encode_utf16().flat_map(|u| u.to_be_bytes()));
        let (text, enc) = decode_text(&be, false).unwrap();
        assert_eq!((text.as_str(), enc), ("ação", "utf-16be"));
    }

    #[test]
    fn utf16_with_a_dangling_byte_does_not_produce_garbage() {
        let mut bytes = utf16le("abc", true);
        bytes.push(0x41); // metade de uma unidade, como numa leitura cortada
        assert_eq!(decode_text(&bytes, true).unwrap().0, "abc");
    }

    #[test]
    fn legacy_ansi_text_falls_back_to_windows_1252() {
        // "ação – “ok”" em Windows-1252: não é UTF-8 válido.
        // `Vec` (e não um array literal): o clippy recusa `from_utf8` num literal inválido.
        let bytes: Vec<u8> = vec![
            0x61, 0xE7, 0xE3, 0x6F, 0x20, 0x96, 0x20, 0x93, 0x6F, 0x6B, 0x94,
        ];
        assert!(std::str::from_utf8(&bytes).is_err());
        let (text, enc) = decode_text(&bytes, false).unwrap();
        assert_eq!((text.as_str(), enc), ("ação – “ok”", "windows-1252"));
    }

    #[test]
    fn cp1252_table_covers_the_whole_0x80_to_0x9f_range() {
        let all: Vec<u8> = (0x80..=0x9F).collect();
        let text = decode_cp1252(&all);
        assert_eq!(text.chars().count(), 32);
        assert!(text.starts_with('€') && text.contains('™') && text.ends_with('Ÿ'));
        assert_eq!(decode_cp1252(&[0xE9, 0x41]), "éA");
    }

    #[test]
    fn a_nul_byte_marks_the_file_as_binary() {
        let err = decode_text(b"MZ\x90\x00\x03\x00", false).unwrap_err();
        assert_eq!(err.code, ViewErrorCode::Binary);
        // Mas um NUL depois da janela examinada não condena o arquivo.
        let mut late = vec![b'a'; BINARY_SNIFF_BYTES + 10];
        late[BINARY_SNIFF_BYTES + 5] = 0;
        assert!(decode_text(&late, false).is_ok());
    }

    #[test]
    fn truncation_in_the_middle_of_a_multibyte_char_keeps_only_valid_text() {
        // "é" = C3 A9; cortar depois do C3 deixa um caractere incompleto no fim.
        let bytes = [b'a', b'b', 0xC3];
        let (text, enc) = decode_text(&bytes, true).unwrap();
        assert_eq!((text.as_str(), enc), ("ab", "utf-8"));
        // Sem truncamento, o mesmo byte solto é ANSI de verdade.
        assert_eq!(decode_text(&bytes, false).unwrap().1, "windows-1252");
    }

    #[test]
    fn empty_file_is_an_empty_text() {
        let (text, _) = decode_text(b"", false).unwrap();
        assert!(text.is_empty());
    }

    #[test]
    fn read_text_reports_size_and_does_not_truncate_small_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.txt");
        fs::write(&path, "linha 1\nlinha 2\n").unwrap();
        let c = read_text(&path).unwrap();
        assert_eq!(c.text, "linha 1\nlinha 2\n");
        assert_eq!((c.truncated, c.total_bytes), (false, 16));
    }

    #[test]
    fn read_text_truncates_big_files_at_the_limit_without_breaking_characters() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("grande.txt");
        // "é" tem 2 bytes: com um byte de abertura, o limite cai no meio de um "é".
        let mut f = File::create(&path).unwrap();
        f.write_all(b"x").unwrap();
        let chunk = "é".repeat(600_000); // 1,2 MB
        f.write_all(chunk.as_bytes()).unwrap();
        drop(f);
        let c = read_text(&path).unwrap();
        assert!(c.truncated);
        assert_eq!(c.total_bytes, 1 + 1_200_000);
        assert_eq!(
            c.encoding, "utf-8",
            "não pode cair em ANSI por causa do corte"
        );
        assert!(c.text.starts_with("xéé") && c.text.ends_with('é'));
        assert!(c.text.len() as u64 <= MAX_TEXT_BYTES);
    }

    #[test]
    fn read_text_errors_are_classified() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            read_text(&dir.path().join("nao-existe.txt"))
                .unwrap_err()
                .code,
            ViewErrorCode::NotFound
        );
        assert_eq!(
            read_text(dir.path()).unwrap_err().code,
            ViewErrorCode::NotAFile
        );
        let bin = dir.path().join("a.bin");
        fs::write(&bin, [0u8, 1, 2, 3]).unwrap();
        assert_eq!(read_text(&bin).unwrap_err().code, ViewErrorCode::Binary);
    }

    #[test]
    fn executables_scripts_shortcuts_and_macro_documents_are_blocked() {
        for name in [
            "a.exe",
            "A.EXE",
            "setup.msi",
            "run.bat",
            "run.cmd",
            "s.ps1",
            "x.vbs",
            "x.js",
            "atalho.lnk",
            "link.url",
            "a.scr",
            "p.hta",
            "lib.dll",
            "p.jar",
            "doc.docm",
            "plan.xlsm",
            "slides.pptm",
            "t.reg",
            "ajuda.chm",
            "app.appx",
            "dados.xlsb",
            "suplemento.xll",
            "show.ppsm",
            "app.apk",
            "pacote.XAPK",
            "split.apks",
            "store.apkm",
        ] {
            assert!(
                is_blocked_for_open(Path::new(name)),
                "{name} deveria ser bloqueado"
            );
        }
    }

    #[test]
    fn windows_name_tricks_do_not_bypass_the_block() {
        for name in [
            "virus.exe.",     // ponto final é ignorado pelo Windows
            "virus.exe ",     // espaço final também
            "virus.exe. . .", // combinados
            "virus.EXE",
            ".exe",             // arquivo só com extensão
            "doc.txt:evil.exe", // fluxo alternativo de dados
            "a.txt::$DATA",
            "semextensao", // sem extensão: não dá para saber o que o sistema faria
            "termina.",
        ] {
            assert!(
                is_blocked_for_open(Path::new(name)),
                "{name:?} deveria ser bloqueado"
            );
        }
    }

    #[test]
    fn ordinary_documents_and_media_are_allowed() {
        for name in [
            "relatorio.pdf",
            "foto.JPG",
            "musica.mp3",
            "video.mkv",
            "planilha.xlsx",
            "texto.docx",
            "slides.pptx",
            "arquivo.zip",
            "notas.txt",
            "livro.epub",
            "a.exe.txt",
            "arquivo.tar.gz",
        ] {
            assert!(
                !is_blocked_for_open(Path::new(name)),
                "{name} deveria ser permitido"
            );
        }
    }

    #[test]
    fn open_default_refuses_blocked_types_missing_files_and_folders_before_touching_the_system() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("programa.exe");
        fs::write(&exe, b"MZ").unwrap();
        assert_eq!(open_default(&exe).unwrap_err().code, ViewErrorCode::Blocked);
        assert_eq!(
            open_default(&dir.path().join("nao-existe.pdf"))
                .unwrap_err()
                .code,
            ViewErrorCode::NotFound
        );
        assert_eq!(
            open_default(dir.path()).unwrap_err().code,
            ViewErrorCode::NotAFile
        );
    }
}
