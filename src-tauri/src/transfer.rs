// transfer.rs — VersePC 互传：信令走官网(8.217)，文件在两台设备间 TCP 直传。
// 协议：魔数VXFER01 + 文件名(u32长度) + 大小(u64) + sha256(32B) + 文件字节流(256KB分块)，接收端最后回 1 字节确认。
// 只做信令不做中转：文件数据不经过任何服务器。
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
        .map_err(|e| format!("无法打开文件: {e}"))?;
    let mut hasher = Sha256::new();
    let mut size: u64 = 0;
    let mut buf = vec![0u8; CHUNK_SIZE];
    loop {
        let n = tokio::io::AsyncReadExt::read(&mut file, &mut buf)
            .await
            .map_err(|e| format!("读取文件失败: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        size += n as u64;
    }
    Ok((format!("{:x}", hasher.finalize()), size))
}

/// 发送方：为指定文件创建互传会话，返回 8 位识别码。
/// 后台任务持续监听 TCP，任何拿到识别码的对端都可直接拉取文件。
#[tauri::command]
pub async fn transfer_start_send(path: String) -> Result<SendSession, String> {
    let file_path = PathBuf::from(&path);
    if !file_path.is_file() {
        return Err("文件不存在".into());
    }
    let file_name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());

    let (hash, size) = hash_file(&file_path).await?;

    let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("无法监听端口: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("获取端口失败: {e}"))?
        .port();

    // 向信令服务器注册会话（携带监听端口，服务端记录发送方公网 IP）
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
        .map_err(|e| format!("信令服务器不可达: {e}"))?;
    let reg: serde_json::Value = resp.json().await.map_err(|e| format!("信令响应异常: {e}"))?;
    let code = reg
        .get("code")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            format!(
                "注册失败: {}",
                reg.get("error").and_then(|v| v.as_str()).unwrap_or("未知错误")
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
                        let offer2 = offer.clone();
                        if let Err(e) = send_file_to(stream, offer2).await {
                            let mut st = offer.status.lock().unwrap();
                            st.error = Some(e);
                        }
                    });
                }
                Err(e) => {
                    let mut st = status.lock().unwrap();
                    st.listening = false;
                    st.error = Some(format!("接受连接失败: {e}"));
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

/// 发送方：查询会话状态（前端轮询展示进度）
#[tauri::command]
pub async fn transfer_send_status(code: String) -> Result<SendStatus, String> {
    let offer = offers()
        .lock()
        .unwrap()
        .get(&code)
        .cloned()
        .ok_or("会话不存在或已失效")?;
    let st = offer.status.lock().unwrap().clone();
    Ok(st)
}

async fn send_file_to(
    mut stream: tokio::net::TcpStream,
    offer: Arc<Offer>,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    {
        let mut st = offer.status.lock().unwrap();
        st.connected = true;
    }
    // 头部：魔数 + 文件名 + 大小 + 哈希
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
        .map_err(|e| format!("发送头部失败: {e}"))?;

    // 文件字节流
    let mut file = tokio::fs::File::open(&offer.path)
        .await
        .map_err(|e| format!("打开文件失败: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut sent: u64 = 0;
    loop {
        let n = tokio::io::AsyncReadExt::read(&mut file, &mut buf)
            .await
            .map_err(|e| format!("读取文件失败: {e}"))?;
        if n == 0 {
            break;
        }
        stream
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("发送数据失败: {e}"))?;
        hasher.update(&buf[..n]);
        sent += n as u64;
        offer.status.lock().unwrap().sent_bytes = sent;
    }
    stream.flush().await.ok();

    // 接收端确认（1 字节：0x01 校验通过）
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
            st.error = Some("对端校验未通过".into());
        }
    }
    Ok(())
}

/// 接收方：凭识别码连接发送方，接收文件并校验 SHA-256
#[tauri::command]
pub async fn transfer_receive(code: String, save_dir: String) -> Result<TransferResult, String> {
    let code = code.trim().to_uppercase().replace(' ', "");
    if code.is_empty() {
        return Err("请输入识别码".into());
    }

    // 信令：换取发送方端点
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{SIGNAL_BASE}/api/transfer/lookup"))
        .query(&[("code", &code)])
        .send()
        .await
        .map_err(|e| format!("信令服务器不可达: {e}"))?;
    let lookup: serde_json::Value = resp.json().await.map_err(|e| format!("信令响应异常: {e}"))?;
    if !lookup.get("ip").is_some() {
        let em = lookup
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("会话不存在")
            .to_string();
        return Err(em);
    }
    let ip = lookup
        .get("ip")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let port = lookup.get("port").and_then(|v| v.as_u64()).unwrap_or(0) as u16;

    // 连接：先按信令地址，失败再尝试本机回环（同机测试场景）
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
    let mut stream = stream.ok_or("无法连接到发送方（可能不在线或端口不可达）")?;

    use tokio::io::AsyncReadExt;
    use tokio::io::AsyncWriteExt;
    // 头部
    let mut magic = [0u8; 8];
    tokio::io::AsyncReadExt::read_exact(&mut stream, &mut magic)
        .await
        .map_err(|e| format!("读取头部失败: {e}"))?;
    if &magic != MAGIC {
        return Err("协议不匹配，对端不是 Verse 互传".into());
    }
    let mut len_buf = [0u8; 4];
    tokio::io::AsyncReadExt::read_exact(&mut stream, &mut len_buf)
        .await
        .map_err(|e| format!("读取文件名失败: {e}"))?;
    let name_len = u32::from_be_bytes(len_buf) as usize;
    if name_len == 0 || name_len > 1024 {
        return Err("文件名长度异常".into());
    }
    let mut name_buf = vec![0u8; name_len];
    tokio::io::AsyncReadExt::read_exact(&mut stream, &mut name_buf)
        .await
        .map_err(|e| format!("读取文件名失败: {e}"))?;
    let file_name = String::from_utf8_lossy(&name_buf).to_string();
    let mut size_buf = [0u8; 8];
    tokio::io::AsyncReadExt::read_exact(&mut stream, &mut size_buf)
        .await
        .map_err(|e| format!("读取大小失败: {e}"))?;
    let file_size = u64::from_be_bytes(size_buf);
    let mut hash_buf = [0u8; 32];
    tokio::io::AsyncReadExt::read_exact(&mut stream, &mut hash_buf)
        .await
        .map_err(|e| format!("读取校验值失败: {e}"))?;
    let expected_hash: String = hash_buf.iter().map(|b| format!("{:02X}", b)).collect();

    // 防路径穿越：仅取文件名部分
    let safe_name = file_name
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("file")
        .to_string();

    let save_dir_path = PathBuf::from(&save_dir);
    tokio::fs::create_dir_all(&save_dir_path)
        .await
        .map_err(|e| format!("无法创建保存目录: {e}"))?;
    let save_path = save_dir_path.join(&safe_name);

    // 接收文件字节流并同步计算哈希
    let mut out = tokio::fs::File::create(&save_path)
        .await
        .map_err(|e| format!("无法写入文件: {e}"))?;
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
            .map_err(|e| format!("接收数据失败: {e}"))?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n])
            .await
            .map_err(|e| format!("写入文件失败: {e}"))?;
        hasher.update(&buf[..n]);
        received += n as u64;
    }
    out.flush().await.ok();

    let actual = hasher.finalize();
    let actual_hash: String = actual.iter().map(|b| format!("{:02X}", b)).collect();
    let hash_ok = actual_hash == expected_hash && received == file_size;
    // 回执确认
    stream
        .write_all(&[if hash_ok { 0x01 } else { 0x00 }])
        .await
        .ok();

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
        return Err("哈希长度异常".into());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| format!("哈希解析失败: {e}"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 完整回路测试：真实信令服务器注册 → 本机 TCP 直传 → SHA-256 校验
    #[tokio::test(flavor = "multi_thread")]
    async fn transfer_roundtrip_via_signal() {
        let dir = std::env::temp_dir().join(format!("vxfer_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("创建临时目录失败");
        let file_path = dir.join("sample.bin");
        let data: Vec<u8> = (0..1_000_000u32).map(|i| (i % 251) as u8).collect();
        std::fs::write(&file_path, &data).expect("写入测试文件失败");

        let session = transfer_start_send(file_path.to_string_lossy().to_string())
            .await
            .expect("创建发送会话失败");
        assert_eq!(session.file_size, data.len() as u64);
        assert_eq!(session.code.len(), 8);

        let save_dir = dir.join("received");
        std::fs::create_dir_all(&save_dir).expect("创建接收目录失败");
        let result = transfer_receive(session.code.clone(), save_dir.to_string_lossy().to_string())
            .await
            .expect("接收失败");
        assert!(result.hash_ok, "哈希校验未通过");
        assert_eq!(result.file_size, data.len() as u64);
        let got = std::fs::read(save_dir.join(&result.file_name)).expect("读取接收文件失败");
        assert_eq!(got, data, "接收内容与发送内容不一致");

        std::fs::remove_dir_all(&dir).ok();
    }
}
