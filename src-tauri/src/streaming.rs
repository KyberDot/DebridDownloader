use crate::state::StreamSession;
use axum::{
    body::Body,
    extract::{Path, State as AxumState},
    http::{header, HeaderMap, Response, StatusCode},
    routing::get,
    Router,
};
use reqwest::Client;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;

type Sessions = Arc<RwLock<HashMap<String, StreamSession>>>;

pub async fn start_streaming_server(
    sessions: Sessions,
    port_holder: Arc<RwLock<Option<u16>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let client = Client::new();
    let app_state = (sessions, client);

    let app = Router::new()
        .route("/stream/{session_id}", get(handle_stream))
        .with_state(app_state);

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    *port_holder.write().await = Some(port);

    log::info!("Streaming proxy started on 127.0.0.1:{}", port);

    axum::serve(listener, app).await?;
    Ok(())
}

async fn handle_stream(
    Path(session_id): Path<String>,
    headers: HeaderMap,
    AxumState((sessions, client)): AxumState<(Sessions, Client)>,
) -> Result<Response<Body>, StatusCode> {
    let session_url = {
        let sessions = sessions.read().await;
        sessions
            .get(&session_id)
            .map(|s| s.url.clone())
            .ok_or(StatusCode::NOT_FOUND)?
    };

    let mut req = client.get(&session_url);
    if let Some(range) = headers.get(header::RANGE) {
        req = req.header(header::RANGE, range);
    }

    let upstream = req.send().await.map_err(|e| {
        log::error!("Streaming proxy upstream error: {}", e);
        StatusCode::BAD_GATEWAY
    })?;

    let status = upstream.status();
    let upstream_headers = upstream.headers().clone();

    let mut builder = Response::builder()
        .status(status.as_u16())
        .header("Access-Control-Allow-Origin", "*");

    for key in &[
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
    ] {
        if let Some(val) = upstream_headers.get(key) {
            builder = builder.header(key, val);
        }
    }

    let body = Body::from_stream(upstream.bytes_stream());
    builder.body(body).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
