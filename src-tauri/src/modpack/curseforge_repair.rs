// modpack/curseforge_repair.rs — CurseForge 整合包 JAR 校验与修复
//
// 轻量/深度完整性校验、损坏扫描、PowerShell/unzip/zip crate 修复与重打包、
// 以及从 JAR 读取 modId。
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde_json::Value;

// ============== JAR 完整性校验 ==============
/// 轻量校验：ZIP 头魔数 + 大小 > 1KB + EOCD 尾
pub fn is_jar_intact(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    if meta.len() < 1024 {
        return false;
    }
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    // PK\x03\x04 = ZIP 本地文件头魔数
    let mut buf = [0u8; 4];
    if file.read(&mut buf).is_err() {
        return false;
    }
    if buf[0] != 0x50 || buf[1] != 0x4B || buf[2] != 0x03 || buf[3] != 0x04 {
        return false;
    }
    // 检查 EOCD 尾（End of Central Directory）
    // EOCD 签名：PK\x05\x06，位于文件末尾 22 字节内
    let file_size = meta.len();
    if file_size < 22 {
        return false;
    }
    let seek_pos = file_size.saturating_sub(22);
    if std::io::Seek::seek(&mut file, std::io::SeekFrom::Start(seek_pos)).is_err() {
        return false;
    }
    let mut tail = Vec::new();
    if file.read_to_end(&mut tail).is_err() {
        return false;
    }
    // 在尾部 22 字节内查找 EOCD 签名
    for i in 0..tail.len().saturating_sub(4) {
        if tail[i] == 0x50 && tail[i + 1] == 0x4B && tail[i + 2] == 0x05 && tail[i + 3] == 0x06 {
            return true;
        }
    }
    false
}

/// 深度校验：用 zip crate 读取所有条目数据，检测内部 entry 损坏
/// 如 "invalid entry size" 这类轻量校验检测不到的损坏
pub fn is_jar_intact_deep(path: &Path) -> bool {
    if !is_jar_intact(path) {
        return false;
    }
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(_) => return false,
    };
    for i in 0..archive.len() {
        let entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => return false,
        };
        // 尝试读取每个 entry 的数据，检测 CRC 校验失败
        if !entry.is_dir() {
            let mut reader = entry;
            let mut buf = Vec::with_capacity(8192);
            if std::io::Read::read_to_end(&mut reader, &mut buf).is_err() {
                return false;
            }
        }
    }
    true
}

// ============== 损坏 JAR 修复 ==============
// 完整实现：PowerShell Expand-Archive + unzip 命令 + zip crate 重打包

/// 扫描 mods 目录下所有 .jar 文件，修复损坏的 JAR
///
/// 修复流程：
/// 1. 轻量校验（大小 + ZIP 头 + EOCD 尾）
/// 2. 深度校验（读取所有 entry 数据）
/// 3. 损坏则尝试修复：
///    a. Windows: PowerShell Expand-Archive 解压 + zip crate 重打包
///    b. 其他平台: unzip 命令解压 + zip crate 重打包
///    c. 无法修复则删除
pub fn repair_corrupted_mod_jars(version_dir: &Path) -> RepairResult {
    let mods_dir = version_dir.join("mods");
    if !mods_dir.exists() {
        return RepairResult::default();
    }

    let mut corrupted: Vec<CorruptedJar> = Vec::new();
    scan_dir_for_corrupted_jars(&mods_dir, &mut corrupted);

    if corrupted.is_empty() {
        return RepairResult::default();
    }

    let mut repaired = 0usize;
    let mut failed = 0usize;

    for jar in &corrupted {
        let mut fixed = false;

        // 临时目录
        let temp_dir = jar.path.with_extension("_repair_tmp");
        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        if let Some(parent) = temp_dir.parent() {
            let _ = fs::create_dir_all(parent);
        }

        // Windows: 尝试 PowerShell Expand-Archive
        if cfg!(target_os = "windows") {
            fixed = try_repair_with_powershell(&jar.path, &temp_dir);
        }

        // 回退：尝试 unzip 命令
        if !fixed {
            fixed = try_repair_with_unzip(&jar.path, &temp_dir);
        }

        // 最后回退：内置 zip 解析（macOS/Linux 无 unzip 时也能修复）
        if !fixed {
            fixed = try_repair_with_zip(&jar.path, &temp_dir);
        }

        // 清理临时目录
        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }

        if fixed {
            repaired += 1;
        } else {
            // 无法修复，删除损坏文件
            let _ = fs::remove_file(&jar.path);
            eprintln!(
                "[Modpack] JAR 文件损坏已删除: {:?} ({})",
                jar.path.file_name(),
                jar.reason
            );
            failed += 1;
        }
    }

    RepairResult { repaired, failed }
}

#[derive(Default, Debug)]
#[allow(dead_code)]
pub struct RepairResult {
    pub repaired: usize,
    pub failed: usize,
}

struct CorruptedJar {
    path: PathBuf,
    reason: &'static str,
}

fn scan_dir_for_corrupted_jars(dir: &Path, corrupted: &mut Vec<CorruptedJar>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_dir_for_corrupted_jars(&path, corrupted);
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !name.to_lowercase().ends_with(".jar") {
            continue;
        }
        let meta = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.len() < 100 {
            corrupted.push(CorruptedJar {
                path,
                reason: "too_small",
            });
            continue;
        }
        if !is_jar_intact(&path) {
            corrupted.push(CorruptedJar {
                path,
                reason: "structure_corrupted",
            });
            continue;
        }
        if !is_jar_intact_deep(&path) {
            corrupted.push(CorruptedJar {
                path,
                reason: "entry_corrupted",
            });
        }
    }
}

/// Windows: PowerShell Expand-Archive 解压 + zip crate 重打包
fn try_repair_with_powershell(jar_path: &Path, temp_dir: &Path) -> bool {
    if !cfg!(target_os = "windows") {
        return false;
    }
    let jar_str = jar_path.to_string_lossy().replace('\'', "''");
    let temp_str = temp_dir.to_string_lossy().replace('\'', "''");
    let ps_cmd = format!(
        "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
        jar_str, temp_str
    );
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output();
    let output = match output {
        Ok(o) => o,
        Err(e) => {
            eprintln!(
                "[Modpack] PowerShell修复失败 {:?}: {}",
                jar_path.file_name(),
                e
            );
            return false;
        }
    };
    if !output.status.success() {
        eprintln!(
            "[Modpack] PowerShell修复失败 {:?}: {}",
            jar_path.file_name(),
            String::from_utf8_lossy(&output.stderr).chars().take(200).collect::<String>()
        );
        return false;
    }
    // 收集解压的文件
    let files = collect_files(temp_dir);
    if files.is_empty() {
        return false;
    }
    // 用 zip crate 重新打包
    if !repack_files(jar_path, &files, temp_dir) {
        return false;
    }
    is_jar_intact_deep(jar_path)
}

/// 内置 zip crate 解压 + 重打包（不依赖外部命令）
fn try_repair_with_zip(jar_path: &Path, temp_dir: &Path) -> bool {
    let Ok(file) = std::fs::File::open(jar_path) else {
        return false;
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return false;
    };
    if crate::plugins::extract_safely(&mut archive, temp_dir).is_err() {
        return false;
    }
    let files = collect_files(temp_dir);
    if files.is_empty() {
        return false;
    }
    if !repack_files(jar_path, &files, temp_dir) {
        return false;
    }
    is_jar_intact_deep(jar_path)
}

/// unzip 命令解压 + zip crate 重打包
fn try_repair_with_unzip(jar_path: &Path, temp_dir: &Path) -> bool {
    let output = std::process::Command::new("unzip")
        .args(["-o"])
        .arg(jar_path)
        .args(["-d"])
        .arg(temp_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();
    let output = match output {
        Ok(o) => o,
        Err(_) => return false,
    };
    if !output.status.success() {
        return false;
    }
    let files = collect_files(temp_dir);
    if files.is_empty() {
        return false;
    }
    if !repack_files(jar_path, &files, temp_dir) {
        return false;
    }
    is_jar_intact_deep(jar_path)
}

fn collect_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let stack = vec![dir.to_path_buf()];
    let mut stack = stack;
    while let Some(d) = stack.pop() {
        let entries = match fs::read_dir(&d) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                files.push(path);
            }
        }
    }
    files
}

/// 用 zip crate 把文件重新打包为 JAR
fn repack_files(jar_path: &Path, files: &[PathBuf], base_dir: &Path) -> bool {
    let tmp_jar = jar_path.with_extension("jar.repacking");
    let file = match fs::File::create(&tmp_jar) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut zip_writer = zip::ZipWriter::new(file);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for f in files {
        let rel = match f.strip_prefix(base_dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if let Ok(data) = fs::read(f) {
            if zip_writer.start_file(&rel_str, options).is_err() {
                continue;
            }
            if zip_writer.write_all(&data).is_err() {
                continue;
            }
        }
    }
    if zip_writer.finish().is_err() {
        let _ = fs::remove_file(&tmp_jar);
        return false;
    }
    // 替换原文件
    if fs::rename(&tmp_jar, jar_path).is_err() {
        let _ = fs::remove_file(jar_path);
        let _ = fs::rename(&tmp_jar, jar_path);
    }
    true
}

// ============== JAR modId 读取 ==============

/// 从 JAR 文件中读取 modId
/// 依次尝试：META-INF/mods.toml → mcmod.info → fabric.mod.json
pub fn read_jar_mod_id(file_path: &Path) -> Option<String> {
    if !file_path.exists() {
        return None;
    }
    let file = fs::File::open(file_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;

    // Forge 1.13+: mods.toml
    if let Ok(entry) = archive.by_name("META-INF/mods.toml") {
        let mut reader = entry;
        let mut text = String::new();
        if std::io::Read::read_to_string(&mut reader, &mut text).is_ok() {
            // TOML 中 [[mods]] 段下的 modId = "xxx"
            let re = regex::Regex::new(r#"\[\[mods\]\][\s\S]*?modId\s*=\s*["']([^"']+)["']"#).ok()?;
            if let Some(cap) = re.captures(&text)
                && let Some(m) = cap.get(1) {
                    return Some(m.as_str().trim().to_string());
                }
        }
    }

    // Forge 旧版: mcmod.info
    if let Ok(entry) = archive.by_name("mcmod.info") {
        let mut reader = entry;
        let mut text = String::new();
        if std::io::Read::read_to_string(&mut reader, &mut text).is_ok()
            && let Ok(data) = serde_json::from_str::<Value>(&text) {
                if let Some(arr) = data.as_array()
                    && let Some(first) = arr.first()
                        && let Some(modid) = first.get("modid").and_then(|v| v.as_str()) {
                            return Some(modid.trim().to_string());
                        }
                if let Some(modid) = data.get("modid").and_then(|v| v.as_str()) {
                    return Some(modid.trim().to_string());
                }
            }
    }

    // Fabric: fabric.mod.json
    if let Ok(entry) = archive.by_name("fabric.mod.json") {
        let mut reader = entry;
        let mut text = String::new();
        if std::io::Read::read_to_string(&mut reader, &mut text).is_ok()
            && let Ok(data) = serde_json::from_str::<Value>(&text)
                && let Some(id) = data.get("id").and_then(|v| v.as_str()) {
                    return Some(id.trim().to_string());
                }
    }

    None
}
