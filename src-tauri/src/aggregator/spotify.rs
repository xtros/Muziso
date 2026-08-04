use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use serde_json::Value;

pub async fn resolve_spotify_url(app: &AppHandle, url: &str, opt_title: Option<&str>, opt_artist: Option<&str>) -> Result<String, String> {
    let clean_url = url.trim();
    let track_id = clean_url
        .replace("sp-", "")
        .split("spotify.com/track/")
        .last()
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();

    let full_spotify_url = if track_id.starts_with("http") {
        track_id.clone()
    } else {
        format!("https://open.spotify.com/track/{}", track_id)
    };

    println!("Spotify: Resolving track ID: {} (title: {:?}, artist: {:?})", track_id, opt_title, opt_artist);

    // Strategy 1: If title & artist are provided from track card, resolve immediately for 0ms delay!
    if let (Some(t), Some(a)) = (opt_title, opt_artist) {
        if !t.is_empty() {
            let search_query = format!("{} {}", t, a);
            println!("Spotify Direct: Resolving audio stream for '{}' via fast search", search_query);
            return crate::aggregator::resolver::resolve_youtube_search(&search_query, Some(t), Some(a)).await;
        }
    }

    // Strategy 2: Try spotiflac-cli sidecar for lossless FLAC stream (if title/artist not supplied)
    let temp_dir = std::env::temp_dir().join("muziso_spotify");
    let _ = std::fs::create_dir_all(&temp_dir);

    if let Ok(cmd) = app.shell().sidecar("spotiflac-cli") {
        let sidecar_command = cmd
            .arg(&full_spotify_url)
            .arg(temp_dir.to_string_lossy().to_string());

        if let Ok(Ok(output)) = tokio::time::timeout(std::time::Duration::from_millis(1000), sidecar_command.output()).await {
            if output.status.success() {
                let output_str = String::from_utf8_lossy(&output.stdout);
                let json_line = output_str.lines().filter(|l| l.trim().starts_with('{')).last().unwrap_or(&output_str);

                if let Ok(parsed) = serde_json::from_str::<Value>(json_line) {
                    if let Some(true) = parsed["success"].as_bool() {
                        if let Some(file_path) = parsed["file"].as_str() {
                            println!("Spotify: Successfully downloaded via spotiflac-cli");
                            return Ok(format!("file:///{}", file_path.replace("\\", "/")));
                        }
                    }
                }
            }
        }
    }

    // Strategy 3: Query Spotify Web API for metadata fallback
    println!("Spotify: Sidecar unavailable. Querying Spotify Web API for track metadata...");
    if let Some(token) = get_spotify_token().await {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(4))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default();

        let api_url = format!("https://api.spotify.com/v1/tracks/{}", track_id);
        if let Ok(resp) = client.get(&api_url).header("Authorization", format!("Bearer {}", token)).send().await {
            if let Ok(json) = resp.json::<Value>().await {
                let title = json["name"].as_str().unwrap_or("").to_string();
                let artist = json["artists"][0]["name"].as_str().unwrap_or("").to_string();

                if !title.is_empty() {
                    let search_query = format!("{} {}", title, artist);
                    println!("Spotify API Fallback: Resolving audio stream for '{}' via YouTube search", search_query);
                    return crate::aggregator::resolver::resolve_youtube_search(&search_query, Some(&title), Some(&artist)).await;
                }
            }
        }
    }

    // Strategy 4: Try oEmbed metadata fallback
    let oembed_url = format!("https://open.spotify.com/oembed?url=https://open.spotify.com/track/{}", track_id);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_default();

    if let Ok(resp) = client.get(&oembed_url).send().await {
        if let Ok(json) = resp.json::<Value>().await {
            if let Some(title) = json["title"].as_str() {
                if !title.is_empty() {
                    println!("Spotify oEmbed Fallback: Resolving audio stream for '{}' via YouTube search", title);
                    return crate::aggregator::resolver::resolve_youtube_search(title, opt_title, opt_artist).await;
                }
            }
        }
    }

    // Strategy 5: Clean URL text search fallback
    let fallback_term = clean_url.replace("sp-", "").replace("https://open.spotify.com/track/", "").replace('-', " ");
    println!("Spotify Final Fallback: Resolving audio stream for query '{}'", fallback_term);
    crate::aggregator::resolver::resolve_youtube_search(&fallback_term, opt_title, opt_artist).await
}

pub async fn get_spotify_token() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .ok()?;

    let res = client.get("https://open.spotify.com/get_access_token?reason=transport&productType=web_player")
        .header("Referer", "https://open.spotify.com/")
        .header("Accept", "application/json")
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "same-origin")
        .header("App-Platform", "WebPlayer")
        .send().await.ok()?;

    let json: Value = res.json().await.ok()?;
    json["accessToken"].as_str().map(|s| s.to_string())
}

#[tauri::command]
pub async fn fetch_spotify_cover(app: tauri::AppHandle, query: String) -> Result<String, String> {
    fetch_spotify_cover_image(&app, &query).await
        .ok_or_else(|| format!("Could not fetch Spotify cover image for '{}'", query))
}

pub async fn fetch_spotify_cover_image(app: &AppHandle, query: &str) -> Option<String> {
    let clean_query = query.trim();
    if clean_query.is_empty() {
        return None;
    }

    // Check if query contains a Spotify Track ID or Spotify URL
    let is_spotify_url_or_id = clean_query.contains("spotify.com/track/") || clean_query.starts_with("sp-");
    if is_spotify_url_or_id {
        let track_id = clean_query
            .replace("sp-", "")
            .split("spotify.com/track/")
            .last()
            .unwrap_or("")
            .split('?')
            .next()
            .unwrap_or("")
            .trim()
            .to_string();

        if !track_id.is_empty() {
            let oembed_url = format!("https://open.spotify.com/oembed?url=https://open.spotify.com/track/{}", track_id);
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(3))
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
                .build()
                .ok();

            if let Some(client) = client {
                if let Ok(resp) = client.get(&oembed_url).send().await {
                    if let Ok(json) = resp.json::<Value>().await {
                        if let Some(img) = json["thumbnail_url"].as_str() {
                            if !img.is_empty() {
                                println!("Spotify: Resolved cover image via oEmbed: {}", img);
                                return Some(img.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    // Fetch using Spotify Official Web API via anonymous web player token
    if let Some(token) = get_spotify_token().await {
        let search_url = format!("https://api.spotify.com/v1/search?q={}&type=track&limit=1", urlencoding::encode(clean_query));
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .build()
            .ok();

        if let Some(client) = client {
            if let Ok(resp) = client.get(&search_url).header("Authorization", format!("Bearer {}", token)).send().await {
                if let Ok(json) = resp.json::<Value>().await {
                    if let Some(items) = json["tracks"]["items"].as_array() {
                        if let Some(first_item) = items.first() {
                            if let Some(images) = first_item["album"]["images"].as_array() {
                                if let Some(first_img) = images.first() {
                                    if let Some(url) = first_img["url"].as_str() {
                                        if !url.is_empty() {
                                            println!("Spotify: Found cover image via Web API for '{}': {}", clean_query, url);
                                            return Some(url.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Try spotiflac-cli sidecar search
    use tauri_plugin_shell::ShellExt;
    if let Ok(cmd) = app.shell().sidecar("spotiflac-cli") {
        if let Ok(output) = cmd.args([clean_query, "SEARCH"]).output().await {
            let out_str = String::from_utf8_lossy(&output.stdout);
            if let Some(json_line) = out_str.lines().find(|l| l.trim().starts_with('{')) {
                if let Ok(parsed) = serde_json::from_str::<Value>(json_line) {
                    if parsed["success"].as_bool() == Some(true) {
                        if let Some(tracks) = parsed["tracks"].as_array() {
                            for track in tracks {
                                let cover = track["images"].as_str().or_else(|| track["cover"].as_str()).unwrap_or("");
                                if !cover.is_empty() {
                                    println!("Spotify: Resolved cover image via spotiflac-cli for '{}': {}", clean_query, cover);
                                    return Some(cover.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}
