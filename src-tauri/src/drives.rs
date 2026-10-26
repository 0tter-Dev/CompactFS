//! Lista os discos do computador (tela "Este computador").
//!
//! Só discos fixos, removíveis e RAM são consultados (rótulo e espaço). Unidades de rede e ópticas
//! não são tocadas, porque uma unidade de rede fora do ar pode travar a chamada por longos períodos.

use serde::Serialize;
#[cfg(any(target_os = "android", test))]
use std::path::{Path, PathBuf};

/// Fora do Windows só alguns tipos são construídos (ex.: no Android, interno e removível).
#[cfg_attr(not(windows), allow(dead_code))]
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

/// Armazenamento interno do Android (o que o usuário vê como "Armazenamento interno").
#[cfg(any(target_os = "android", test))]
const ANDROID_INTERNAL: &str = "/storage/emulated/0";

/// Pontos de montagem de armazenamentos removíveis (`/storage/<id>`) numa saída de `/proc/mounts`.
/// `emulated` e `self` são o armazenamento interno e seus atalhos, não volumes removíveis.
#[cfg(any(target_os = "android", test))]
fn removable_roots(mounts: &str) -> Vec<String> {
    let mut roots: Vec<String> = Vec::new();
    for mount in mounts.lines().filter_map(|l| l.split_whitespace().nth(1)) {
        let Some(id) = mount.strip_prefix("/storage/") else {
            continue;
        };
        // O /proc/mounts escapa espaços em octal (`\040`); ids de volume nunca têm barra nem isso.
        if id.is_empty() || id.contains(['/', '\\']) || matches!(id, "emulated" | "self") {
            continue;
        }
        let root = format!("/storage/{id}");
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    roots
}

/// Raiz do armazenamento (e o nome que a interface mostra) a que `path` pertence, se houver.
#[cfg(any(target_os = "android", test))]
fn volume_root_in(path: &Path, removable: &[String]) -> Option<(PathBuf, String)> {
    if path.starts_with(ANDROID_INTERNAL) {
        return Some((
            PathBuf::from(ANDROID_INTERNAL),
            "Armazenamento interno".to_owned(),
        ));
    }
    removable.iter().find_map(|root| {
        path.starts_with(root).then(|| {
            let id = root.rsplit('/').next().unwrap_or(root);
            (PathBuf::from(root), format!("Armazenamento removível {id}"))
        })
    })
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

#[cfg(target_os = "android")]
mod android {
    use super::{removable_roots, volume_root_in, Drive, DriveKind, ANDROID_INTERNAL};
    use std::{
        ffi::CString,
        fs,
        path::{Path, PathBuf},
    };

    /// (total, livre) em bytes do sistema de arquivos onde `path` está.
    fn space(path: &str) -> Option<(u64, u64)> {
        let c_path = CString::new(path).ok()?;
        // SAFETY: `statvfs` é só dados numéricos, para os quais tudo zero é um valor válido.
        let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
        // SAFETY: `c_path` é uma string C válida e `st` é um destino válido para escrita.
        if unsafe { libc::statvfs(c_path.as_ptr(), &mut st) } != 0 {
            return None;
        }
        #[allow(clippy::useless_conversion)]
        let (unit, blocks, avail) = (
            u64::from(st.f_frsize),
            u64::from(st.f_blocks),
            u64::from(st.f_bavail),
        );
        Some((blocks * unit, avail * unit))
    }

    fn describe(path: &str, label: String, kind: DriveKind) -> Drive {
        let ready = fs::read_dir(path).is_ok();
        let (total_bytes, free_bytes) = match space(path).filter(|_| ready) {
            Some((total, free)) => (Some(total), Some(free)),
            None => (None, None),
        };
        Drive {
            path: path.to_owned(),
            label: Some(label),
            kind,
            ready,
            total_bytes,
            free_bytes,
        }
    }

    fn removable() -> Vec<String> {
        removable_roots(&fs::read_to_string("/proc/mounts").unwrap_or_default())
    }

    pub fn list_drives() -> Vec<Drive> {
        let mut drives = vec![describe(
            ANDROID_INTERNAL,
            "Armazenamento interno".to_owned(),
            DriveKind::Fixed,
        )];
        for root in removable() {
            let one = std::slice::from_ref(&root);
            if let Some((_, label)) = volume_root_in(Path::new(&root), one) {
                drives.push(describe(&root, label, DriveKind::Removable));
            }
        }
        drives
    }

    pub fn volume_root(path: &Path) -> Option<(PathBuf, String)> {
        volume_root_in(path, &removable())
    }
}

#[cfg(target_os = "android")]
pub use android::{list_drives, volume_root};

/// Em outros sistemas (macOS, Linux) a navegação parte de um caminho conhecido, não de uma lista de discos.
#[cfg(not(any(windows, target_os = "android")))]
pub fn list_drives() -> Vec<Drive> {
    Vec::new()
}

/// Raiz do armazenamento e o nome mostrado na trilha: só existe no Android.
#[cfg(not(target_os = "android"))]
pub fn volume_root(_path: &std::path::Path) -> Option<(std::path::PathBuf, String)> {
    None
}

#[cfg(not(windows))]
pub fn suppress_critical_error_dialogs() {}

#[cfg(test)]
mod pure_tests {
    use super::*;

    const MOUNTS: &str = "\
/dev/block/dm-9 /data ext4 rw,seclabel 0 0
/dev/fuse /storage/emulated fuse rw,lazytime 0 0
/dev/fuse /storage/1A2B-3C4D fuse rw,lazytime 0 0
/dev/block/vold/public:179,1 /mnt/media_rw/1A2B-3C4D exfat rw 0 0
tmpfs /storage tmpfs rw 0 0
/dev/fuse /storage/self/primary fuse rw 0 0
/dev/fuse /storage/9999-0000/Android/obb fuse rw 0 0
/dev/fuse /storage/9999-0000 fuse rw 0 0
/dev/fuse /storage/1A2B-3C4D fuse rw,lazytime 0 0
/dev/fuse /storage/Meu\\040Cartao fuse rw 0 0
";

    #[test]
    fn removable_roots_picks_only_storage_volumes_once() {
        assert_eq!(
            removable_roots(MOUNTS),
            vec![
                "/storage/1A2B-3C4D".to_owned(),
                "/storage/9999-0000".to_owned()
            ]
        );
    }

    #[test]
    fn removable_roots_is_empty_without_volumes() {
        assert!(removable_roots("").is_empty());
        let only_internal = "tmpfs /storage tmpfs rw 0 0\n/dev/fuse /storage/emulated fuse rw 0 0";
        assert!(removable_roots(only_internal).is_empty());
    }

    #[test]
    fn volume_root_finds_the_internal_storage_and_names_it() {
        let root = volume_root_in(Path::new("/storage/emulated/0/DCIM/Camera"), &[]).unwrap();
        assert_eq!(root.0, PathBuf::from("/storage/emulated/0"));
        assert_eq!(root.1, "Armazenamento interno");
        let exact = volume_root_in(Path::new("/storage/emulated/0"), &[]).unwrap();
        assert_eq!(exact.0, PathBuf::from("/storage/emulated/0"));
    }

    #[test]
    fn volume_root_finds_a_removable_volume_by_its_id() {
        let removable = vec!["/storage/1A2B-3C4D".to_owned()];
        let (root, label) =
            volume_root_in(Path::new("/storage/1A2B-3C4D/Fotos"), &removable).unwrap();
        assert_eq!(root, PathBuf::from("/storage/1A2B-3C4D"));
        assert_eq!(label, "Armazenamento removível 1A2B-3C4D");
    }

    #[test]
    fn volume_root_does_not_confuse_siblings_with_similar_names() {
        let removable = vec!["/storage/1A2B-3C4D".to_owned()];
        assert!(volume_root_in(Path::new("/storage/1A2B-3C4D0/x"), &removable).is_none());
        assert!(volume_root_in(Path::new("/storage/emulated/01"), &[]).is_none());
        assert!(volume_root_in(Path::new("/storage/emulated"), &[]).is_none());
        assert!(volume_root_in(Path::new("/sdcard"), &[]).is_none());
    }
}

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
