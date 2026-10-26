//! Miniaturas de arquivos (somente leitura).
//!
//! No Windows usa as miniaturas do próprio sistema (`IShellItemImageFactory`): peso zero no
//! executável e cobre imagens, vídeos, PDFs e o que houver de codecs ou extensões instalados.
//! Consequência conhecida: o Windows guarda essas miniaturas no cache dele (`thumbcache`) da
//! máquina que roda o app, como o Explorer já faz. O app não grava nada por conta própria.

use std::{
    path::{Path, PathBuf},
    sync::{mpsc, Condvar, LazyLock, Mutex},
    thread,
    time::Duration,
};

use serde::Serialize;

pub const MIN_SIZE: u32 = 32;
pub const MAX_SIZE: u32 = 512;
/// Extrações simultâneas: o suficiente para encher a tela rápido sem sufocar um HD lento.
const MAX_CONCURRENT: usize = 4;
/// Tempo máximo por miniatura. Um extrator do sistema pode travar em arquivo ruim ou de rede.
pub const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ThumbErrorCode {
    /// Sem miniatura para este tipo de arquivo (ou arquivo ilegível/corrompido).
    Unavailable,
    #[cfg_attr(not(windows), allow(dead_code))]
    NotFound,
    /// O extrator do sistema demorou demais ou travou.
    Timeout,
    Other,
}

#[derive(Serialize, Debug)]
pub struct ThumbError {
    pub code: ThumbErrorCode,
    pub message: String,
}

impl ThumbError {
    pub fn new(code: ThumbErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Imagem RGBA com alfa direto (não pré-multiplicado), linhas de cima para baixo.
#[derive(Debug)]
pub struct Thumbnail {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Corpo binário enviado à interface: largura e altura (u32 little-endian cada) e depois o RGBA.
pub fn encode(thumb: &Thumbnail) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + thumb.rgba.len());
    out.extend_from_slice(&thumb.width.to_le_bytes());
    out.extend_from_slice(&thumb.height.to_le_bytes());
    out.extend_from_slice(&thumb.rgba);
    out
}

/// Converte BGRA (GDI) em RGBA. O alfa que o Windows devolve já é direto (não pré-multiplicado).
/// Alguns extratores deixam o alfa todo zerado em imagens de 32 bits; sem tratar isso a miniatura
/// ficaria invisível, então, nesse caso (e só nele), tudo vira opaco.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn bgra_to_rgba(mut px: Vec<u8>) -> Vec<u8> {
    let all_transparent = px.as_chunks::<4>().0.iter().all(|p| p[3] == 0);
    for p in px.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
        if all_transparent {
            p[3] = 255;
        }
    }
    px
}

/// Limita quantas extrações rodam ao mesmo tempo.
struct Limiter {
    in_use: Mutex<usize>,
    freed: Condvar,
    max: usize,
}

struct Permit<'a>(&'a Limiter);

impl Limiter {
    const fn new(max: usize) -> Self {
        Self {
            in_use: Mutex::new(0),
            freed: Condvar::new(),
            max,
        }
    }

    fn acquire(&self) -> Permit<'_> {
        let mut n = self.in_use.lock().unwrap_or_else(|e| e.into_inner());
        while *n >= self.max {
            n = self.freed.wait(n).unwrap_or_else(|e| e.into_inner());
        }
        *n += 1;
        Permit(self)
    }
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        let mut n = self.0.in_use.lock().unwrap_or_else(|e| e.into_inner());
        *n -= 1;
        self.0.freed.notify_one();
    }
}

static LIMITER: LazyLock<Limiter> = LazyLock::new(|| Limiter::new(MAX_CONCURRENT));

/// Roda `work` numa thread própria e espera no máximo `timeout`. Se estourar, a thread fica para
/// trás (não há como interromper uma chamada de sistema), mas quem chamou não fica preso.
fn run_with_timeout<T: Send + 'static>(
    timeout: Duration,
    work: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(work());
    });
    rx.recv_timeout(timeout).ok()
}

/// Miniatura de `path`, com `size` (lado máximo em pixels) entre `MIN_SIZE` e `MAX_SIZE`.
/// Bloqueante: chame de uma thread de trabalho, nunca da thread principal.
pub fn thumbnail(path: &Path, size: u32) -> Result<Thumbnail, ThumbError> {
    let size = size.clamp(MIN_SIZE, MAX_SIZE);
    let path: PathBuf = path.to_path_buf();
    run_with_timeout(TIMEOUT, move || {
        let _permit = LIMITER.acquire();
        platform::extract(&path, size)
    })
    .unwrap_or_else(|| {
        Err(ThumbError::new(
            ThumbErrorCode::Timeout,
            "A miniatura demorou demais para ficar pronta.",
        ))
    })
}

#[cfg(windows)]
mod platform {
    use super::{bgra_to_rgba, ThumbError, ThumbErrorCode, Thumbnail};
    use std::{ffi::c_void, mem::size_of, path::Path};
    use windows::core::HSTRING;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
    };
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, IBindCtx, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_THUMBNAILONLY,
    };

    /// Garante COM inicializado (apartamento de thread única) na thread atual.
    struct ComGuard(bool);

    impl ComGuard {
        fn init() -> Self {
            // SAFETY: inicialização padrão de COM; pareada com CoUninitialize no Drop se teve sucesso.
            let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            Self(hr.is_ok())
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                // SAFETY: só chamada se o CoInitializeEx desta thread teve sucesso.
                unsafe { CoUninitialize() };
            }
        }
    }

    fn unavailable(msg: &str) -> ThumbError {
        ThumbError::new(ThumbErrorCode::Unavailable, msg)
    }

    pub fn extract(path: &Path, size: u32) -> Result<Thumbnail, ThumbError> {
        let _com = ComGuard::init();
        if !path.exists() {
            return Err(ThumbError::new(
                ThumbErrorCode::NotFound,
                "Arquivo não encontrado.",
            ));
        }
        let wide = HSTRING::from(path.to_string_lossy().as_ref());
        // SAFETY: `wide` vive durante a chamada; sem BindCtx.
        let factory: IShellItemImageFactory =
            unsafe { SHCreateItemFromParsingName(&wide, None::<&IBindCtx>) }
                .map_err(|_| unavailable("O sistema não abriu este arquivo."))?;
        let side = i32::try_from(size).unwrap_or(256);
        // SAFETY: `factory` é um objeto COM válido; THUMBNAILONLY evita receber só o ícone genérico.
        let hbitmap =
            unsafe { factory.GetImage(SIZE { cx: side, cy: side }, SIIGBF_THUMBNAILONLY) }
                .map_err(|_| unavailable("Sem miniatura para este tipo de arquivo."))?;

        let result = read_bitmap(hbitmap);
        // SAFETY: o HBITMAP pertence a nós (GetImage transfere a posse) e não é mais usado.
        unsafe {
            let _ = DeleteObject(HGDIOBJ(hbitmap.0));
        }
        result
    }

    fn read_bitmap(hbitmap: HBITMAP) -> Result<Thumbnail, ThumbError> {
        let other = |msg: &str| ThumbError::new(ThumbErrorCode::Other, msg);
        let mut bm = BITMAP::default();
        // SAFETY: `bm` é um BITMAP válido para escrita, com o tamanho informado.
        let got = unsafe {
            GetObjectW(
                HGDIOBJ(hbitmap.0),
                size_of::<BITMAP>() as i32,
                Some(&mut bm as *mut BITMAP as *mut c_void),
            )
        };
        if got == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 {
            return Err(other("Miniatura inválida."));
        }
        let (w, h) = (bm.bmWidth as usize, bm.bmHeight as usize);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: bm.bmWidth,
                biHeight: -bm.bmHeight, // negativo = de cima para baixo
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bgra = vec![0u8; w * h * 4];
        // SAFETY: `bgra` tem w*h*4 bytes; o DC é liberado logo em seguida.
        let lines = unsafe {
            let hdc = GetDC(None);
            let lines = GetDIBits(
                hdc,
                hbitmap,
                0,
                h as u32,
                Some(bgra.as_mut_ptr() as *mut c_void),
                &mut info,
                DIB_RGB_COLORS,
            );
            ReleaseDC(None, hdc);
            lines
        };
        if lines == 0 {
            return Err(other("Não foi possível ler os pixels da miniatura."));
        }
        Ok(Thumbnail {
            width: w as u32,
            height: h as u32,
            rgba: bgra_to_rgba(bgra),
        })
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{ThumbError, ThumbErrorCode, Thumbnail};
    use std::path::Path;

    pub fn extract(_path: &Path, _size: u32) -> Result<Thumbnail, ThumbError> {
        Err(ThumbError::new(
            ThumbErrorCode::Unavailable,
            "Miniaturas ainda não estão disponíveis neste sistema.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::atomic::{AtomicUsize, Ordering},
        sync::Arc,
        time::Instant,
    };

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join(name)
    }

    #[test]
    fn bgra_is_swapped_to_rgba_and_alpha_is_kept() {
        let out = bgra_to_rgba(vec![10, 20, 30, 128, 1, 2, 3, 255]);
        assert_eq!(out, [30, 20, 10, 128, 3, 2, 1, 255]);
    }

    #[test]
    fn fully_zero_alpha_becomes_opaque_but_partial_alpha_is_untouched() {
        // Extrator que esqueceu o alfa: sem tratar, a miniatura ficaria invisível.
        assert_eq!(
            bgra_to_rgba(vec![1, 2, 3, 0, 4, 5, 6, 0]),
            [3, 2, 1, 255, 6, 5, 4, 255]
        );
        // Imagem realmente com transparência (algum pixel com alfa): não mexer.
        assert_eq!(
            bgra_to_rgba(vec![1, 2, 3, 0, 4, 5, 6, 200]),
            [3, 2, 1, 0, 6, 5, 4, 200]
        );
    }

    #[test]
    fn encode_prefixes_width_and_height_little_endian() {
        let t = Thumbnail {
            width: 3,
            height: 258,
            rgba: vec![9, 8, 7, 6],
        };
        assert_eq!(encode(&t), [3, 0, 0, 0, 2, 1, 0, 0, 9, 8, 7, 6]);
    }

    #[test]
    fn timeout_returns_none_instead_of_blocking_the_caller() {
        let started = Instant::now();
        let out = run_with_timeout(Duration::from_millis(60), || {
            thread::sleep(Duration::from_millis(600));
            1
        });
        assert!(out.is_none());
        assert!(started.elapsed() < Duration::from_millis(400));
        assert_eq!(run_with_timeout(Duration::from_secs(5), || 7), Some(7));
    }

    #[test]
    fn limiter_never_runs_more_than_the_maximum_at_once() {
        let limiter = Arc::new(Limiter::new(3));
        let (current, peak) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
        let handles: Vec<_> = (0..16)
            .map(|_| {
                let (limiter, current, peak) = (limiter.clone(), current.clone(), peak.clone());
                thread::spawn(move || {
                    let _permit = limiter.acquire();
                    let now = current.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(now, Ordering::SeqCst);
                    thread::sleep(Duration::from_millis(15));
                    current.fetch_sub(1, Ordering::SeqCst);
                })
            })
            .collect();
        handles.into_iter().for_each(|h| h.join().unwrap());
        assert_eq!(
            peak.load(Ordering::SeqCst),
            3,
            "deveria chegar a 3 e nunca passar"
        );
        assert_eq!(current.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn the_limiter_releases_a_permit_even_if_the_work_panics() {
        let limiter = Arc::new(Limiter::new(1));
        let l = limiter.clone();
        let _ = thread::spawn(move || {
            let _permit = l.acquire();
            panic!("falha simulada");
        })
        .join();
        // Se a permissão não fosse devolvida, isto travaria para sempre.
        let _permit = limiter.acquire();
    }

    #[cfg(windows)]
    #[test]
    fn a_jpeg_gets_a_real_thumbnail_with_the_right_colors() {
        let t = thumbnail(&fixture("photo.jpg"), 128).expect("miniatura do JPEG");
        assert_eq!(
            (t.width, t.height),
            (96, 64),
            "não deve ampliar além do original"
        );
        assert_eq!(t.rgba.len(), 96 * 64 * 4);
        let px = |x: usize, y: usize| {
            let i = (y * 96 + x) * 4;
            [t.rgba[i], t.rgba[i + 1], t.rgba[i + 2], t.rgba[i + 3]]
        };
        // Esquerda: pouco vermelho e muito azul; direita: o oposto (tolerância da compressão JPEG).
        let (left, right) = (px(2, 32), px(93, 32));
        assert!(
            left[0] < 30 && left[2] > 220 && left[3] == 255,
            "esquerda: {left:?}"
        );
        assert!(
            right[0] > 220 && right[2] < 30 && right[3] == 255,
            "direita: {right:?}"
        );
        assert!((60..100).contains(&left[1]), "verde deve ser ~80: {left:?}");
    }

    #[cfg(windows)]
    #[test]
    fn png_transparency_comes_back_as_straight_alpha() {
        let t = thumbnail(&fixture("alpha.png"), 128).expect("miniatura do PNG");
        let px = |x: usize| {
            let i = (32 * t.width as usize + x) * 4;
            [t.rgba[i], t.rgba[i + 1], t.rgba[i + 2], t.rgba[i + 3]]
        };
        let (half, clear) = (px(5), px(t.width as usize - 5));
        // Vermelho puro com alfa 128: em alfa direto o R continua ~255 (pré-multiplicado daria ~128).
        assert!(
            half[0] > 240 && half[3].abs_diff(128) < 6,
            "metade translúcida: {half:?}"
        );
        assert_eq!(clear[3], 0, "lado transparente: {clear:?}");
    }

    #[cfg(windows)]
    #[test]
    fn unsupported_corrupt_and_missing_files_fail_cleanly() {
        let corrupt = thumbnail(&fixture("corrupt.jpg"), 128).unwrap_err();
        assert_eq!(corrupt.code, ThumbErrorCode::Unavailable);
        let text = thumbnail(&fixture("notes.txt"), 128).unwrap_err();
        assert_eq!(text.code, ThumbErrorCode::Unavailable);
        let missing = thumbnail(&fixture("nao-existe.png"), 128).unwrap_err();
        assert_eq!(missing.code, ThumbErrorCode::NotFound);
    }

    #[cfg(windows)]
    #[test]
    fn requested_size_is_clamped_on_both_ends() {
        let tiny = thumbnail(&fixture("photo.jpg"), 1).expect("tamanho mínimo");
        assert!(
            tiny.width >= 32 || tiny.height >= 32,
            "{}x{}",
            tiny.width,
            tiny.height
        );
        // large.jpg tem 1024x768: sem o limite, o sistema devolveria algo maior que MAX_SIZE.
        let huge = thumbnail(&fixture("large.jpg"), 100_000).expect("tamanho máximo");
        let side = huge.width.max(huge.height);
        assert!(
            side <= MAX_SIZE,
            "{}x{} passou de {MAX_SIZE}",
            huge.width,
            huge.height
        );
        assert!(
            side >= MAX_SIZE - 1,
            "deveria usar o máximo permitido, veio {side}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn the_image_is_not_flipped_vertically() {
        let t = thumbnail(&fixture("topbottom.png"), 128).expect("miniatura do PNG");
        let px = |x: usize, y: usize| {
            let i = (y * t.width as usize + x) * 4;
            [t.rgba[i], t.rgba[i + 1], t.rgba[i + 2], t.rgba[i + 3]]
        };
        let (top, bottom) = (px(32, 5), px(32, t.height as usize - 6));
        // Em cima verde puro (0,200,0), embaixo magenta (220,0,220).
        assert!(
            top[0] < 30 && top[1] > 170 && top[2] < 30,
            "topo deveria ser verde: {top:?}"
        );
        assert!(
            bottom[0] > 190 && bottom[1] < 30 && bottom[2] > 190,
            "base deveria ser magenta: {bottom:?}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn many_parallel_requests_all_succeed() {
        let handles: Vec<_> = (0..24)
            .map(|_| thread::spawn(|| thumbnail(&fixture("photo.jpg"), 96).is_ok()))
            .collect();
        assert!(handles.into_iter().all(|h| h.join().unwrap()));
    }
}
