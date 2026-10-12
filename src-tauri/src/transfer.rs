// transfer.rs - VersePC ??:?????(8.217),???????? TCP ???
// ??:??VXFER01 + ???(u32??) + ??(u64) + sha256(32B) + ?????(256KB??),?????? 1 ?????
// ????????:?????????????
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

const SIGNAL_BASE: &str = "https://www.verselauncher.cn";
const MAGIC: &[u8; 8] = b"VXFER01\0";
const CHUNK_SIZE: usize = 256 * 1024;

#[derive(Serialize, Clone)]
pub struct SendSession {
    pub code: String,
    pub file_name: String,
    pub file_size: u64,
}

#[derive(Serialize, Clone, Default)]
pub struct SendStatus {
    pub listening: bool,
    pub connected: bool,
    pub sent_bytes: u64,
    pub total_bytes: u64,
    pub transfers: u64,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct TransferResult {
    pub file_name: String,
    pub saved_path: String,
    pub file_size: u64,
    pub hash_ok: bool,
}

struct Offer {
    path: PathBuf,
    file_name: String,
    file_size: u64,
    hash: String,
    status: Arc<Mutex<SendStatus>>,
}

fn offers() -> &'static Mutex<HashMap<String, Arc<Offer>>> {
    static OFFERS: OnceLock<Mutex<HashMap<String, Arc<Offer>>>> = OnceLock::new();
    OFFERS.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn hash_file(path: &PathBuf) -> Result<(String, u64), String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("??????: {e}"))?;
    let mut hasher = Sha256::new();
    let mut size: u64 = 0;
    let mut buf = vec![0u8; CHUNK_SIZE];
    loop {
        let n = tokio::io::AsyncReadExt::read(&mut file, &mut buf)
            .await
            .map_err(|e| format!("??????: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        size += n as u64;
    }
    Ok((format!("{:x}", hasher.finalize()), size))
}

/// ???:???????????,?? 8 ?????
/// ???????? TCP,???????????????????
#[tauri::command]
pub async fn transfer_start_send(path: String) -> Result<SendSession, String> {
    let file_path = PathBuf::from(&path);
    if !file_path.is_file() {
        return Err("?????".into());
    }
    let file_name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());

    let (hash, size) = hash_file(&file_path).await?;

    let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("??????: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("??????: {e}"))?
        .port();

    // ??????????(??????,?????????? IP)
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{SIGNAL_BASE}/api/transfer/register"))
        .json(&serde_json::json!({
            "fileName": file_name,
            "fileSize": size,
            "fileHash": hash,
            "port": port,
        }))
        .send()
        .await
        .map_err(|e| format!("????????: {e}"))?;
    let reg: serde_json::Value = resp.json().await.map_err(|e| format!("??????: {e}"))?;
    let code = reg
        .get("code")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            format!(
                "????: {}",
                reg.get("error").and_then(|v| v.as_str()).unwrap_or("????")
            )
        })?
        .to_string();

    let status = Arc::new(Mutex::new(SendStatus {
        listening: true,
        total_bytes: size,
        ..Default::default()
    }));
    let resp_file_name = file_name.clone();
    let offer = Arc::new(Offer {
        path: file_path,
        file_name,
        file_size: size,
        hash,
        status: status.clone(),
    });
    offers().lock().unwrap().insert(code.clone(), offer.clone());

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _peer)) => {
                    let offer = offer.clone();
                    tokio::spawn(async move {
                        if let Err(e) = send_file_to(stream, offer).await {
                            let mut st = offer.status.lock().unwrap();
                            st.error = Some(e);
                        }
                    });
                }
                Err(e) => {
                    let mut st = status.lock().unwrap();
                    st.listening = false;
                    st.error = Some(format!("??????: {e}"));
                    break;
                }
            }
        }
    });

    Ok(SendSession {
        code,
        file_name: resp_file_name,
        file_size: size,
    })
}

/// ???:??????(????????)
#[tauri::command]
pub async fn transfer_send_status(code: String) -> Result<SendStatus, String> {
    let offer = offers()
        .lock()
        .unwrap()
        .get(&code)
        .cloned()
        .ok_or("?????????")?;
    let st = offer.status.lock().unwrap().clone();
    Ok(st)
}

async fn send_file_to(
    mut stream: tokio::net::TcpStream,
    offer: Arc<Offer>,
) -> Result<(), String> {
    {
        let mut st = offer.status.lock().unwrap();
        st.connected = true;
    }
    use tokio::io::AsyncWriteExt;
    // ??:?? + ??? + ?? + ??
    let name_bytes = offer.file_name.as_bytes();
    let mut header = Vec::with_capacity(8 + 4 + name_bytes.len() + 8 + 32);
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&(name_bytes.len() as u32).to_be_bytes());
    header.extend_from_slice(name_bytes);
    header.extend_from_slice(&offer.file_size.to_be_bytes());
    header.extend_from_slice(&hex_to_bytes(&offer.hash)?);
    stream
        .write_all(&header)
        .await
        .map_err(|e| format!("??????: {e}"))?;

    // ?????
    let mut file = tokio::fs::File::open(&offer.path)
        .await
        .map_err(|e| format!("??????: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut sent: u64 = 0;
    loop {
        let n = tokio::io::AsyncReadExt::read(&mut file, &mut buf)
            .await
            .map_err(|e| format!("??????: {e}"))?;
        if n == 0 {
            break;
        }
        stream
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("??????: {e}"))?;
        hasher.update(&buf[..n]);
        sent += n as u64;
        offer.status.lock().unwrap().sent_bytes = sent;
    }
    stream.flush().await.ok();

    // ?????(1 ??:0x01 ????)
    let mut ack = [0u8; 1];
    use tokio::io::AsyncReadExt;
    let read_res = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        tokio::io::AsyncReadExt::read_exact(&mut stream, &mut ack),
    )
    .await;
    let verified = matches!(read_res, Ok(Ok(_))) && ack[0] == 0x01;
    {
        let mut st = offer.status.lock().unwrap();
        st.connected = false;
        if verified {
            st.transfers += 1;
        } else {
            st.error = Some("???????".into());
        }
    }
    Ok(())
}

/// ???:?????????,??????? SHA-256
#[tauri::command]
pub async fn transfer_receive(code: String, save_dir: String) -> Result<TransferResult, String> {
    let code = code.trim().to_uppercase().replace(' ', "");
    if code.is_empty() {
        return Err("??????".into());
    }

    // ??:???????
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{SIGNAL_BASE}/api/transfer/lookup"))
        .query(&[("code", &code)])
        .send()
        .await
        .map_err(|e| format!("????????: {e}"))?;
    let lookup: serde_json::Value = resp.json().await.map_err(|e| format!("??????: {e}"))?;
    if !lookup.get("ip").is_some() {
        let em = lookup
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("?????")
            .to_string();
        return Err(em);
    }
    let ip = lookup
        .get("ip")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let port = lookup.get("port").and_then(|v| v.as_u64()).unwrap_or(0) as u16;

    // ??:??????,?????????(??????)
    let mut stream = None;
    for target in [format!("{ip}:{port}"), format!("127.0.0.1:{port}")] {
        if let Ok(s) = tokio::time::timeout(
            std::time::Duration::from_secs(8),
            tokio::net::TcpStream::connect(&target),
        )
        .await
        {
            match s {
                Ok(sock) => {
                    stream = Some(sock);
                    break;
                }
                Err(_) => continue,
            }
        }
    }
    let mut stream = stream.ok_or("????????(???????????)")?;

    use tokio::io::AsyncReadExt;
    // ??
    let mut magic = [0u8; 8];
    tokio::io::AsyncReadExt::read_exact(&mut stream, &mut magic)
        .await
        .map_err(|e| format!("??????: {e}"))?;
    if &magic != MAGIC {
        return Err("?????,???? Verse ??".into());
    }
    let mut len_buf = [0u8; 4];
    tokio::io::AsyncReadExt::read_exact(&mut stream, &mut len_buf)
        .await
        .map_err(|e| format!("???????: {e}"))?;
    let name_len = u32::from_be_bytes(len_buf) as usize;
    if name_len == 0 || name_len > 1024 {
        return Err("???????".into());
    }
    let mut name_buf = vec![0u8; name_len];
    tokio::io::AsyncReadExt::read_exact(&mut stream, &mut name_buf)
        .await
        .map_err(|e| format!("???????: {e}"))?;
    let file_name = String::from_utf8_lossy(&name_buf).to_string();
    let mut size_buf = [0u8; 8];
    tokio::io::AsyncReadExt::read_exact(&mut stream, &mut size_buf)
        .await
        .map_err(|e| format!("??????: {e}"))?;
    let file_size = u64::from_be_bytes(size_buf);
    let mut hash_buf = [0u8; 32];
    tokio::io::AsyncReadExt::read_exact(&mut stream, &mut hash_buf)
        .await
        .map_err(|e| format!("???????: {e}"))?;
    let expected_hash = hex::encode_upper(hash_buf);

    // ?????:???????
    let safe_name = file_name
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("file")
        .to_string();

    let save_dir_path = PathBuf::from(&save_dir);
    tokio::fs::create_dir_all(&save_dir_path)
        .await
        .map_err(|e| format!("????????: {e}"))?;
    let save_path = save_dir_path.join(&safe_name);

    // ??????????????
    let mut out = tokio::fs::File::create(&save_path)
        .await
        .map_err(|e| format!("??????: {e}"))?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut buf = vec![0u8; CHUNK_SIZE];
    loop {
        let want = std::cmp::min(buf.len(), (file_size - received) as usize);
        if want == 0 {
            break;
        }
        let n = tokio::io::AsyncReadExt::read(&mut stream, &mut buf[..want])
            .await
            .map_err(|e| format!("??????: {e}"))?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n])
            .await
            .map_err(|e| format!("??????: {e}"))?;
        hasher.update(&buf[..n]);
        received += n as u64;
    }
    use tokio::io::AsyncWriteExt;
    out.flush().await.ok();

    let actual_hash = format!("{:X}", hasher.finalize());
    let hash_ok = actual_hash == expected_hash && received == file_size;
    // ????
    use tokio::io::AsyncWriteExt;
    stream.write_all(&[if hash_ok { 0x01 } else { 0x00 }]).await.ok();

    if !hash_ok {
        return Ok(TransferResult {
            file_name: safe_name,
            saved_path: save_path.to_string_lossy().to_string(),
            file_size: received,
            hash_ok: false,
        });
    }

    Ok(TransferResult {
        file_name: safe_name,
        saved_path: save_path.to_string_lossy().to_string(),
        file_size: received,
        hash_ok: true,
    })
}

fn hex_to_bytes(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err("??????".into());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| format!("??????: {e}"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ??????:????????? ? ?? TCP ?? ? SHA-256 ??
    #[tokio::test(flavor = "multi_thread")]
    async fn transfer_roundtrip_via_signal() {
        let dir = std::env::temp_dir().join(format!("vxfer_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("????????");
        let file_path = dir.join("sample.bin");
        let data: Vec<u8> = (0..1_000_000u32).map(|i| (i % 251) as u8).collect();
        std::fs::write(&file_path, &data).expect("????????");

        let session = transfer_start_send(file_path.to_string_lossy().to_string())
            .await
            .expect("????????");
        assert_eq!(session.file_size, data.len() as u64);
        assert_eq!(session.code.len(), 8);

        let save_dir = dir.join("received");
        std::fs::create_dir_all(&save_dir).expect("????????");
        let result = transfer_receive(session.code.clone(), save_dir.to_string_lossy().to_string())
            .await
            .expect("????");
        assert!(result.hash_ok, "???????");
        assert_eq!(result.file_size, data.len() as u64);
        let got = std::fs::read(save_dir.join(&result.file_name)).expect("????????");
        assert_eq!(got, data, "????????????");

        std::fs::remove_dir_all(&dir).ok();
    }
}
