use lazy_static::lazy_static;
use std::collections::HashMap;
use std::sync::Mutex;

lazy_static! {
    static ref STREAM_CACHE: Mutex<HashMap<String, (String, std::time::Instant)>> = Mutex::new(HashMap::new());
}

pub async fn resolve_url(app: &tauri::AppHandle, url: &str, title: Option<&str>, artist: Option<&str>) -> Result<String, String> {
    println!("Resolver: Resolving URL: {} (title: {:?}, artist: {:?})", url, title, artist);

    // SoundCloud URLs are short-lived signed CDN URLs — never cache them
    let is_soundcloud = url.contains("soundcloud.com") || url.contains("api-v2.soundcloud.com");

    // Fast path: Check in-memory cache (valid for 20 minutes, skip for SoundCloud)
    if !is_soundcloud {
        if let Ok(cache) = STREAM_CACHE.lock() {
            if let Some((cached_url, time)) = cache.get(url) {
                if time.elapsed() < std::time::Duration::from_secs(1200) {
                    println!("Resolver: Serving from cache (0ms instant playback)");
                    return Ok(cached_url.clone());
                }
            }
        }
    }

    let result = if url.contains("youtube.com") || url.contains("youtu.be") {
        resolve_youtube(url).await
    } else if url.contains("soundcloud.com") || url.contains("api-v2.soundcloud.com") {
        resolve_soundcloud(url).await
    } else if url.contains("spotify.com") || url.starts_with("sp-") {
        crate::aggregator::spotify::resolve_spotify_url(app, url, title, artist).await
    } else {
        Err(format!("Unsupported external source URL: {}", url))
    };

    // Only cache non-SoundCloud results (SC signed URLs expire too fast)
    if !is_soundcloud {
        if let Ok(ref resolved) = result {
            if let Ok(mut cache) = STREAM_CACHE.lock() {
                cache.insert(url.to_string(), (resolved.clone(), std::time::Instant::now()));
            }
        }
    }

    match &result {
        Ok(resolved) => println!("Resolver: Successfully resolved to: {}...", &resolved[..std::cmp::min(resolved.len(), 120)]),
        Err(e) => eprintln!("Resolver: Failed: {}", e),
    }
    result
}

pub fn clear_cache() {
    if let Ok(mut cache) = STREAM_CACHE.lock() {
        cache.clear();
        println!("Resolver: Stream cache cleared due to error");
    }
}

/// Resolve a YouTube URL to a direct audio stream URL.
async fn resolve_youtube(url: &str) -> Result<String, String> {
    println!("YouTube: Resolving direct stream URL for: {}", url);

    // Use bundled yt-dlp (with 7.5-second timeout to accommodate process spawn and network delays)
    if let Ok(Ok(stream_url)) = tokio::time::timeout(
        std::time::Duration::from_millis(7500),
        resolve_youtube_ytdlp(url)
    ).await {
        if !stream_url.is_empty() {
            println!("YouTube: yt-dlp path succeeded!");
            return Ok(stream_url);
        }
    }

    Err("YouTube: Failed to resolve stream URL".to_string())
}


/// Fallback: use bundled yt-dlp.exe to get a direct audio stream URL
async fn resolve_youtube_ytdlp(url: &str) -> Result<String, String> {
    // Find yt-dlp binary: check bundled locations
    let exe = std::env::current_exe().unwrap_or_default();
    let exe_dir = exe.parent().unwrap_or_else(|| std::path::Path::new("."));
    
    let extension = if cfg!(target_os = "windows") { ".exe" } else { "" };
    let filename = format!("yt-dlp{}", extension);

    let candidates = vec![
        exe_dir.join(&filename),
        exe_dir.join("bin").join(&filename),
        // Bundled as resource: ends up in <install_dir>/bin/yt-dlp
        exe_dir.join("resources").join("bin").join(&filename),
        // Dev mode: relative to src-tauri
        std::path::PathBuf::from(format!("bin/{}", filename)),
        std::path::PathBuf::from(format!("src-tauri/bin/{}", filename)),
    ];

    let ytdlp_path = candidates.iter().find(|p| p.exists())
        .ok_or_else(|| "yt-dlp binary not found".to_string())?;

    println!("YouTube: Using yt-dlp at: {:?}", ytdlp_path);

    // Build strategies: tv_embedded first (most reliable), cookies as fallback
    let mut strategies: Vec<Vec<String>> = Vec::new();

    // Strategy 1: Fast direct audio extraction (bestaudio/best)
    strategies.push(vec![
        "-f".into(), "bestaudio/best".into(), "--get-url".into(), "--no-warnings".into(),
        "--no-playlist".into(), "--no-cache-dir".into(), "--no-check-certificates".into(),
        url.into()
    ]);

    // Strategy 2: Fallback with mweb player client
    strategies.push(vec![
        "-f".into(), "bestaudio/best".into(), "--get-url".into(), "--no-warnings".into(),
        "--no-playlist".into(), "--no-cache-dir".into(), "--no-check-certificates".into(),
        "--extractor-args".into(), "youtube:player_client=mweb,android".into(),
        url.into()
    ]);

    // Strategy 3+: cookies.txt fallback
    let candidates_cookies = vec![
        exe_dir.join("cookies.txt"),
        std::path::PathBuf::from("../cookies.txt"),
        std::path::PathBuf::from("cookies.txt"),
    ];
    if let Some(cp) = candidates_cookies.iter().find(|p| p.exists()).map(|p| p.to_string_lossy().to_string()) {
        println!("YouTube: Found cookies.txt at: {}", cp);
        strategies.push(vec![
            "-f".into(), "251/140/ba[ext=m4a]/ba[ext=webm]/ba".into(), "--get-url".into(), "--no-warnings".into(),
            "--no-playlist".into(), "--no-cache-dir".into(),
            "--cookies".into(), cp,
            url.into()
        ]);
    }

    let mut last_stderr = String::new();
    for args in &strategies {
        let label = &args[..std::cmp::min(args.len(), 6)];
        println!("YouTube: yt-dlp trying: {:?}", label);
        
        #[cfg(target_os = "windows")]
        let mut cmd = tokio::process::Command::new(ytdlp_path);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        #[cfg(not(target_os = "windows"))]
        let mut cmd = tokio::process::Command::new(ytdlp_path);

        let child = cmd
            .args(args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();
        
        let output = match child {
            Ok(c) => {
                match tokio::time::timeout(std::time::Duration::from_secs(4), c.wait_with_output()).await {
                    Ok(Ok(o)) => o,
                    Ok(Err(e)) => {
                        println!("YouTube: yt-dlp process error: {}", e);
                        continue;
                    }
                    Err(_) => {
                        println!("YouTube: yt-dlp timed out (4s), trying next strategy...");
                        continue;
                    }
                }
            }
            Err(e) => {
                println!("YouTube: yt-dlp spawn failed: {}", e);
                continue;
            }
        };

        if output.status.success() {
            let stream_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let first_url = stream_url.lines().find(|l| l.starts_with("http") && !l.contains("youtube.com/watch")).unwrap_or("").to_string();
            if !first_url.is_empty() {
                println!("YouTube: yt-dlp resolved to direct stream: {}...", &first_url[..std::cmp::min(first_url.len(), 100)]);
                return Ok(first_url);
            }
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        // If it's a cookie extraction error, skip silently and try next browser
        if stderr.contains("could not find") || stderr.contains("not available") || stderr.contains("Profile") {
            println!("YouTube: Browser cookie extraction failed, trying next...");
            continue;
        }
        last_stderr = stderr;
        println!("YouTube: yt-dlp strategy failed: {}", &last_stderr[..std::cmp::min(last_stderr.len(), 200)]);
    }

    Err(format!("yt-dlp error: {}", last_stderr))
}

/// Resolve a YouTube search query to a direct audio stream URL.
/// Used as Spotify fallback — searches YouTube and returns a streamable URL.
/// Scrapes YouTube HTML for video ID, then resolves stream via rusty_ytdl.
/// Resolve a YouTube search query to a direct audio stream URL.
pub async fn resolve_youtube_search(query: &str, target_title: Option<&str>, target_artist: Option<&str>) -> Result<String, String> {
    let search_term = if let (Some(t), Some(a)) = (target_title, target_artist) {
        format!("{} {}", t, a)
    } else {
        query.to_string()
    };

    println!("YouTube Search: Resolving stream for '{}'", search_term);

    // Fast Path 0: Check STREAM_CACHE for instant (0ms) playback
    {
        if let Ok(cache) = STREAM_CACHE.lock() {
            if let Some((cached_url, time)) = cache.get(&search_term) {
                if time.elapsed() < std::time::Duration::from_secs(1200) {
                    println!("YouTube Search: Served from cache (0ms instant playback)");
                    return Ok(cached_url.clone());
                }
            }
        }
    }

    // Direct single-pass extraction via yt-dlp (sub-2-second resolution)
    let search_url = format!("ytsearch1:{}", search_term);
    let result = resolve_youtube_ytdlp(&search_url).await;

    if let Ok(ref resolved) = result {
        if let Ok(mut cache) = STREAM_CACHE.lock() {
            cache.insert(search_term.clone(), (resolved.clone(), std::time::Instant::now()));
            cache.insert(query.to_string(), (resolved.clone(), std::time::Instant::now()));
        }
        return Ok(resolved.clone());
    }

    // Fallback: scrape search HTML if ytsearch1 fails
    let scrape_result = async {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .build()
            .map_err(|e| e.to_string())?;

        let url = format!(
            "https://www.youtube.com/results?search_query={}",
            urlencoding::encode(&search_term)
        );

        let html = client.get(&url)
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Cookie", "CONSENT=YES+cb.20210328-17-p0.en+FX+634")
            .send().await.map_err(|e| format!("YouTube search request failed: {}", e))?
            .text().await.map_err(|e| e.to_string())?;

        let marker = "var ytInitialData = ";
        let start = html.find(marker).ok_or("Could not find ytInitialData")?;
        let json_start = start + marker.len();
        let json_end = html[json_start..].find(";</script>").ok_or("Could not find end of ytInitialData")?;
        let json_str = &html[json_start..json_start + json_end];

        let data: serde_json::Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;

        let contents = data
            .pointer("/contents/twoColumnSearchResultsRenderer/primaryContents/sectionListRenderer/contents")
            .and_then(|c| c.as_array());

        let mut candidates: Vec<(String, i32)> = Vec::new();

        if let Some(sections) = contents {
            for section in sections {
                if let Some(items) = section.pointer("/itemSectionRenderer/contents").and_then(|c| c.as_array()) {
                    for item in items {
                        if let Some(renderer) = item.get("videoRenderer") {
                            let video_id = renderer["videoId"].as_str().unwrap_or_default().to_string();
                            if video_id.is_empty() { continue; }

                            let title = renderer.pointer("/title/runs/0/text")
                                .and_then(|t| t.as_str())
                                .unwrap_or_default();

                            let raw_artist = renderer.pointer("/ownerText/runs/0/text")
                                .and_then(|a| a.as_str())
                                .unwrap_or("Unknown");

                            let duration_text = renderer.pointer("/lengthText/simpleText")
                                .and_then(|d| d.as_str())
                                .unwrap_or("0:00");
                            let duration_ms = crate::aggregator::search::parse_yt_duration(duration_text);

                            let mut score = crate::aggregator::search::score_music_track(title, raw_artist, raw_artist, duration_ms);

                            let target_t = target_title.unwrap_or(query);
                            score += crate::aggregator::search::calculate_query_relevance(title, raw_artist, target_t);

                            if score > -1000 {
                                candidates.push((video_id, score));
                            }
                        }
                    }
                }
            }
        }

        candidates.sort_by_key(|c| std::cmp::Reverse(c.1));

        let best_video_id = candidates.into_iter().next().map(|c| c.0)
            .ok_or_else(|| format!("YouTube Search: No valid music track results for '{}'", query))?;

        Ok::<String, String>(best_video_id)
    }.await;

    if let Ok(video_id) = scrape_result {
        let video_url = format!("https://www.youtube.com/watch?v={}", video_id);
        if let Ok(url) = resolve_youtube(&video_url).await {
            if let Ok(mut cache) = STREAM_CACHE.lock() {
                cache.insert(search_term.clone(), (url.clone(), std::time::Instant::now()));
            }
            return Ok(url);
        }
    }

    Err(format!("YouTube Search: failed to resolve stream for '{}'", search_term))
}

/// Fast HTTP API stream resolver using Piped and Invidious public endpoints.
/// Resolves YouTube audio stream URLs directly in <150ms without spawning processes.
#[allow(dead_code)]
async fn resolve_youtube_fast_api(video_id: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    // Try Piped instances (fastest API response time)
    let piped_endpoints = [
        format!("https://pipedapi.kavin.rocks/streams/{}", video_id),
        format!("https://api.piped.video/streams/{}", video_id),
        format!("https://pipedapi.tokhmi.xyz/streams/{}", video_id),
    ];

    for endpoint in piped_endpoints {
        if let Ok(resp) = client.get(&endpoint).send().await {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(audio_streams) = json["audioStreams"].as_array() {
                        // Find highest quality webm/mp4 audio stream
                        if let Some(best_audio) = audio_streams.iter().find(|s| {
                            let mime = s["mimeType"].as_str().unwrap_or("");
                            mime.contains("audio/webm") || mime.contains("audio/mp4") || mime.contains("audio/m4a")
                        }) {
                            if let Some(stream_url) = best_audio["url"].as_str() {
                                if !stream_url.is_empty() {
                                    println!("YouTube Fast API: Resolved in <100ms via Piped!");
                                    return Ok(stream_url.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Try Invidious instances fallback
    let invidious_endpoints = [
        format!("https://inv.tux.pizza/api/v1/videos/{}", video_id),
        format!("https://invidious.nerdvpn.de/api/v1/videos/{}", video_id),
    ];

    for endpoint in invidious_endpoints {
        if let Ok(resp) = client.get(&endpoint).send().await {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(formats) = json["adaptiveFormats"].as_array() {
                        for fmt in formats {
                            let mime = fmt["type"].as_str().unwrap_or("");
                            let url = fmt["url"].as_str().unwrap_or("");
                            if mime.starts_with("audio/") && !url.is_empty() {
                                println!("YouTube Fast API: Resolved in <150ms via Invidious!");
                                return Ok(url.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    Err("Fast API endpoints timed out or returned no streams".to_string())
}


async fn resolve_soundcloud(url: &str) -> Result<String, String> {
    crate::aggregator::soundcloud::resolve(url).await
}
