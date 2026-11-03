// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Минимальный HTTP/1.1-клиент (keep-alive, Content-Length) и обёртка над API DS спайка.
//! Свой клиент вместо библиотеки — чтобы не тянуть в спайк сетевой стек с TLS: DS слушает
//! только loopback.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;

use base64ct::{Base64, Encoding};
use serde_json::{json, Value};

pub struct Http {
    addr: String,
    conn: Option<BufReader<TcpStream>>,
}

impl Http {
    pub fn new(addr: &str) -> Self {
        Self {
            addr: addr.to_owned(),
            conn: None,
        }
    }

    fn once(&mut self, method: &str, path: &str, body: &[u8]) -> std::io::Result<(u16, Vec<u8>)> {
        if self.conn.is_none() {
            let s = TcpStream::connect(&self.addr)?;
            s.set_nodelay(true)?;
            self.conn = Some(BufReader::with_capacity(64 * 1024, s));
        }
        let conn = self.conn.as_mut().expect("соединение");
        let head = format!(
            "{method} {path} HTTP/1.1\r\nHost: ds\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            body.len()
        );
        let s = conn.get_mut();
        s.write_all(head.as_bytes())?;
        s.write_all(body)?;
        let mut line = String::new();
        if conn.read_line(&mut line)? == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
        let status: u16 = line
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .ok_or(std::io::ErrorKind::InvalidData)?;
        let mut len = 0usize;
        loop {
            line.clear();
            conn.read_line(&mut line)?;
            let l = line.trim_end();
            if l.is_empty() {
                break;
            }
            if let Some((k, v)) = l.split_once(':') {
                if k.eq_ignore_ascii_case("content-length") {
                    len = v
                        .trim()
                        .parse()
                        .map_err(|_| std::io::ErrorKind::InvalidData)?;
                }
            }
        }
        let mut buf = vec![0; len];
        conn.read_exact(&mut buf)?;
        Ok((status, buf))
    }

    /// Запрос с одним повтором на новом соединении (keep-alive мог закрыться).
    pub fn call(
        &mut self,
        method: &str,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, DsError> {
        let body = body.map(|v| v.to_string()).unwrap_or_default();
        let res = match self.once(method, path, body.as_bytes()) {
            Ok(r) => Ok(r),
            Err(_) => {
                self.conn = None;
                self.once(method, path, body.as_bytes())
            }
        };
        let (status, buf) = res.map_err(|e| {
            self.conn = None;
            DsError::io(e)
        })?;
        let v: Value = serde_json::from_slice(&buf).map_err(|_| DsError::io("не JSON"))?;
        if status >= 300 {
            return Err(DsError {
                status,
                code: v["code"].as_str().unwrap_or("").to_owned(),
                current_epoch: v["current_epoch"].as_u64(),
            });
        }
        Ok(v)
    }
}

/// Отказ DS: HTTP-статус и код из тела.
#[derive(Debug, Clone)]
pub struct DsError {
    pub status: u16,
    pub code: String,
    pub current_epoch: Option<u64>,
}

impl DsError {
    /// Исход запроса неизвестен: сеть или ошибка сервера. Отправленный commit в этом случае
    /// сбрасывать нельзя — DS мог его принять.
    pub fn unknown_outcome(&self) -> bool {
        self.status == 0 || self.status >= 500
    }

    fn io(e: impl std::fmt::Display) -> Self {
        Self {
            status: 0,
            code: format!("IO: {e}"),
            current_epoch: None,
        }
    }
}

impl std::fmt::Display for DsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.status, self.code)
    }
}

impl std::error::Error for DsError {}

pub fn b64(b: &[u8]) -> String {
    Base64::encode_string(b)
}

pub fn unb64(v: &Value) -> Vec<u8> {
    v.as_str()
        .and_then(|s| Base64::decode_vec(s).ok())
        .unwrap_or_default()
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Handshake-сообщение группы, как его отдаёт DS.
#[derive(Debug, Clone)]
pub struct Handshake {
    pub seq: u64,
    pub epoch: u64,
    pub kind: u8,
    pub sender: String,
    pub from_external_sender: bool,
    pub blob: Vec<u8>,
}

pub const KIND_PROPOSAL: u8 = 1;
pub const KIND_COMMIT: u8 = 2;

/// API DS спайка.
pub struct Ds {
    pub http: Http,
}

impl Ds {
    pub fn new(addr: &str) -> Self {
        Self {
            http: Http::new(addr),
        }
    }

    pub fn external_sender(&mut self) -> Result<Vec<u8>, DsError> {
        Ok(unb64(
            &self.http.call("GET", "/v1/external-sender", None)?["entry"],
        ))
    }

    pub fn upload_key_packages(&mut self, device: &str, kps: &[Vec<u8>]) -> Result<(), DsError> {
        let kps: Vec<String> = kps.iter().map(|k| b64(k)).collect();
        self.http
            .call(
                "POST",
                &format!("/v1/devices/{device}/key-packages"),
                Some(&json!({ "key_packages": kps })),
            )
            .map(|_| ())
    }

    pub fn create_group(
        &mut self,
        gid: &[u8],
        creator: &str,
        leaf_limit: u32,
    ) -> Result<(), DsError> {
        self.http
            .call(
                "POST",
                "/v1/groups",
                Some(&json!({"group_id": b64(gid), "creator_device_id": creator, "leaf_limit": leaf_limit})),
            )
            .map(|_| ())
    }

    pub fn join(&mut self, gid: &[u8], device: &str) -> Result<(), DsError> {
        self.http
            .call(
                "POST",
                &format!("/v1/groups/{}/join", hex(gid)),
                Some(&json!({ "device_id": device })),
            )
            .map(|_| ())
    }

    pub fn remove(&mut self, gid: &[u8], device: &str) -> Result<(), DsError> {
        self.http
            .call(
                "POST",
                &format!("/v1/groups/{}/remove", hex(gid)),
                Some(&json!({ "device_id": device })),
            )
            .map(|_| ())
    }

    /// Отправить handshake; возвращает (seq, эпоха после него).
    pub fn submit(
        &mut self,
        gid: &[u8],
        device: &str,
        kind: u8,
        blob: &[u8],
        welcome: Option<&[u8]>,
    ) -> Result<(u64, u64), DsError> {
        let mut body = json!({"sender_device_id": device, "kind": kind, "blob": b64(blob)});
        if let Some(w) = welcome {
            body["welcome"] = json!(b64(w));
        }
        let path = format!("/v1/groups/{}/handshakes", hex(gid));
        // Ответ мог потеряться после того, как DS принял commit: повтор того же blob DS
        // отвечает тем же результатом, а не EPOCH_MISMATCH — иначе автор сбросил бы свой
        // commit и отстал бы от группы, которую сам продвинул.
        // Исход сетевой ошибки и 5xx неизвестен (например, потерян ответ Postgres на COMMIT):
        // повторяем — повтор того же commit-а DS идемпотентен (ревью, раунд 3, Н7).
        let mut res = self.http.call("POST", &path, Some(&body));
        for _ in 0..3 {
            match &res {
                Err(e) if e.unknown_outcome() => res = self.http.call("POST", &path, Some(&body)),
                _ => break,
            }
        }
        let v = res?;
        Ok((
            v["seq"].as_u64().unwrap_or(0),
            v["epoch"].as_u64().unwrap_or(0),
        ))
    }

    pub fn handshakes(
        &mut self,
        gid: &[u8],
        after: u64,
        wait_ms: u64,
    ) -> Result<Vec<Handshake>, DsError> {
        let v = self.http.call(
            "GET",
            &format!(
                "/v1/groups/{}/handshakes?after_seq={after}&wait_ms={wait_ms}",
                hex(gid)
            ),
            None,
        )?;
        Ok(v["handshakes"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|h| Handshake {
                        seq: h["seq"].as_u64().unwrap_or(0),
                        epoch: h["epoch"].as_u64().unwrap_or(0),
                        kind: h["kind"].as_u64().unwrap_or(0) as u8,
                        sender: h["sender_device_id"].as_str().unwrap_or("").to_owned(),
                        from_external_sender: h["from_external_sender"].as_bool().unwrap_or(false),
                        blob: unb64(&h["blob"]),
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Welcome-ы устройства: (эпоха, блоб).
    pub fn welcomes(&mut self, device: &str, wait_ms: u64) -> Result<Vec<(u64, Vec<u8>)>, DsError> {
        let v = self.http.call(
            "GET",
            &format!("/v1/devices/{device}/welcomes?wait_ms={wait_ms}"),
            None,
        )?;
        Ok(v["welcomes"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|w| (w["epoch"].as_u64().unwrap_or(0), unb64(&w["blob"])))
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Состояние группы на DS: эпоха и карта листьев.
    pub fn group(&mut self, gid: &[u8]) -> Result<(u64, Vec<(u32, String)>), DsError> {
        let v = self
            .http
            .call("GET", &format!("/v1/groups/{}", hex(gid)), None)?;
        let mut leaves: Vec<(u32, String)> = v["leaves"]
            .as_object()
            .map(|m| {
                m.iter()
                    .map(|(k, d)| {
                        (
                            k.parse().unwrap_or(u32::MAX),
                            d.as_str().unwrap_or("").to_owned(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        leaves.sort();
        Ok((v["epoch"].as_u64().unwrap_or(0), leaves))
    }

    pub fn stats(&mut self) -> Result<Value, DsError> {
        self.http.call("GET", "/v1/stats", None)
    }

    pub fn reset_stats(&mut self) -> Result<(), DsError> {
        self.http.call("POST", "/v1/stats/reset", None).map(|_| ())
    }
}
