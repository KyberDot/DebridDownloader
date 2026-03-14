use crate::scrapers::{self, SearchResponse};

#[tauri::command]
pub async fn search_torrents(
    query: String,
    category: Option<String>,
    sort_by: Option<String>,
    page: Option<u32>,
) -> Result<SearchResponse, String> {
    let params = scrapers::SearchParams {
        query,
        category,
        sort_by,
        page,
    };

    Ok(scrapers::search_all(&params).await)
}
