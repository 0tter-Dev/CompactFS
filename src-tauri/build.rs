use std::{env, fs, path::Path};

/// Manifesto mínimo que pede Common Controls v6. O `tauri-build` já o embute no app, mas não nos
/// binários de teste, que sem ele nem iniciam no Windows (STATUS_ENTRYPOINT_NOT_FOUND).
const TEST_MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0"
        processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
    </dependentAssembly>
  </dependency>
</assembly>
"#;

fn main() {
    tauri_build::build();

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let out_dir = env::var("OUT_DIR").expect("OUT_DIR");
        let manifest = Path::new(&out_dir).join("test.manifest");
        fs::write(&manifest, TEST_MANIFEST).expect("escrever manifesto de teste");
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
