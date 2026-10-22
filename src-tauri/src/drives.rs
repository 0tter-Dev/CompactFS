//! Lista os discos do computador (tela "Este computador").
//!
//! Só discos fixos, removíveis e RAM são consultados (rótulo e espaço). Unidades de rede e ópticas
//! não são tocadas, porque uma unidade de rede fora do ar pode travar a chamada por longos períodos.

use serde::Serialize;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DriveKind {
    Removable,
    Fixed,
    Network,
    Optical,
    Ram,
    Unknown,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// Raiz do disco, por exemplo `D:\`.
    pub path: String,
    pub label: Option<String>,
    pub kind: DriveKind,
    /// `false` quando o disco existe, mas não tem mídia ou não responde (ex.: leitor de cartão vazio).
    pub ready: bool,
    pub total_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
}

#[cfg(windows)]
mod imp {
    use super::{Drive, DriveKind};
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
    };
    use windows::Win32::System::Diagnostics::Debug::{SetErrorMode, SEM_FAILCRITICALERRORS};

    // Valores retornados por GetDriveTypeW.
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    const DRIVE_REMOTE: u32 = 4;
    const DRIVE_CDROM: u32 = 5;
    const DRIVE_RAMDISK: u32 = 6;

    pub(super) fn kind_of(drive_type: u32) -> DriveKind {
        match drive_type {
            DRIVE_REMOVABLE => DriveKind::Removable,
            DRIVE_FIXED => DriveKind::Fixed,
            DRIVE_REMOTE => DriveKind::Network,
            DRIVE_CDROM => DriveKind::Optical,
            DRIVE_RAMDISK => DriveKind::Ram,
            _ => DriveKind::Unknown,
        }
    }

    /// Evita que o Windows abra a caixa "Não há disco na unidade" quando um disco some ou não responde.
    pub fn suppress_critical_error_dialogs() {
        // SAFETY: só altera o modo de erro do processo, sem ponteiros.
        unsafe {
            SetErrorMode(SEM_FAILCRITICALERRORS);
        }
    }

    fn describe(letter: char) -> Drive {
        let path = format!("{letter}:\\");
        let root = HSTRING::from(path.as_str());
        // SAFETY: `root` é um HSTRING vivo durante a chamada.
        let kind = kind_of(unsafe { GetDriveTypeW(&root) });

        let mut drive = Drive {
            path,
            label: None,
            kind,
            ready: true,
            total_bytes: None,
            free_bytes: None,
        };
        if !matches!(
            kind,
            DriveKind::Fixed | DriveKind::Removable | DriveKind::Ram
        ) {
            return drive;
        }

        let mut name = [0u16; 261];
        // SAFETY: `root` vive durante a chamada e `name` é um buffer válido para escrita.
        let info = unsafe { GetVolumeInformationW(&root, Some(&mut name), None, None, None, None) };
        if info.is_err() {
            drive.ready = false;
            return drive;
        }
        let len = name.iter().position(|&c| c == 0).unwrap_or(name.len());
        let label = String::from_utf16_lossy(&name[..len]);
        drive.label = (!label.is_empty()).then_some(label);

        let (mut free, mut total) = (0u64, 0u64);
        // SAFETY: os ponteiros apontam para variáveis locais válidas; PCWSTR vem de um HSTRING vivo.
        let space = unsafe {
            GetDiskFreeSpaceExW(
                PCWSTR(root.as_ptr()),
                Some(&mut free),
                Some(&mut total),
                None,
            )
        };
        if space.is_ok() {
            drive.total_bytes = Some(total);
            drive.free_bytes = Some(free);
        }
        drive
    }

    pub fn list_drives() -> Vec<Drive> {
        // SAFETY: sem argumentos.
        let mask = unsafe { GetLogicalDrives() };
        (0u8..26)
            .filter(|i| mask & (1u32 << i) != 0)
            .map(|i| describe((b'A' + i) as char))
            .collect()
    }
}

#[cfg(windows)]
pub use imp::{list_drives, suppress_critical_error_dialogs};

/// Em outros sistemas a navegação parte de um caminho conhecido, não de uma lista de discos.
#[cfg(not(windows))]
pub fn list_drives() -> Vec<Drive> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn suppress_critical_error_dialogs() {}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn lists_the_system_drive_with_label_and_space() {
        let drives = list_drives();
        assert!(!drives.is_empty(), "nenhum disco encontrado");
        let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        let root = format!("{system}\\");
        let found = drives
            .iter()
            .find(|d| d.path.eq_ignore_ascii_case(&root))
            .unwrap_or_else(|| panic!("disco do sistema {root} ausente em {drives:?}"));
        assert_eq!(found.kind, DriveKind::Fixed);
        assert!(found.ready);
        let (total, free) = (found.total_bytes.unwrap(), found.free_bytes.unwrap());
        // Estritamente menor: o disco do sistema nunca está 100% livre. Com `<=`, trocar total e
        // livre (ambos iguais) passaria despercebido.
        assert!(total > 0 && free < total, "total={total} livre={free}");
    }

    #[test]
    fn every_drive_path_is_a_letter_root() {
        for d in list_drives() {
            let b = d.path.as_bytes();
            assert!(
                b.len() == 3 && b[0].is_ascii_uppercase() && &d.path[1..] == ":\\",
                "caminho inesperado: {}",
                d.path
            );
        }
    }

    #[test]
    fn drive_kinds_map_from_windows_drive_types() {
        assert_eq!(imp::kind_of(2), DriveKind::Removable);
        assert_eq!(imp::kind_of(3), DriveKind::Fixed);
        assert_eq!(imp::kind_of(4), DriveKind::Network);
        assert_eq!(imp::kind_of(5), DriveKind::Optical);
        assert_eq!(imp::kind_of(6), DriveKind::Ram);
        assert_eq!(imp::kind_of(0), DriveKind::Unknown);
        assert_eq!(imp::kind_of(1), DriveKind::Unknown);
    }
}
