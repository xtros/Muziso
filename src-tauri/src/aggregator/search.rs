use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub struct ExternalTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u64,
    pub artwork_url: String,
    pub source: String,
    pub stream_url: Option<String>,
}

#[tauri::command]
pub async fn search_external(app: tauri::AppHandle, query: String, source: String, page: Option<u32>) -> Result<Vec<ExternalTrack>, String> {
    let page = page.unwrap_or(0);
    if query.contains("spotify.com/track/") {
        let mut title = "Play Spotify Track".to_string();
        let mut artist = "Spotify".to_string();
        let mut artwork_url = "https://upload.wikimedia.org/wikipedia/commons/1/19/Spotify_logo_without_text.svg".to_string();

        use tauri_plugin_shell::ShellExt;
        if let Ok(cmd) = app.shell().sidecar("spotiflac-cli") {
            if let Ok(output) = cmd.args([&query, "METADATA"]).output().await {
                if let Ok(out_str) = String::from_utf8(output.stdout) {
                    if let Some(json_start) = out_str.find('{') {
                        let json_str = &out_str[json_start..];
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(json_str) {
                            if let Some(t) = json["title"].as_str() { title = t.to_string(); }
                            if let Some(a) = json["artist"].as_str() { artist = a.to_string(); }
                            if let Some(img) = json["cover"].as_str() { artwork_url = img.to_string(); }
                        }
                    }
                }
            }
        }

        if artwork_url.contains("upload.wikimedia.org") || artwork_url.is_empty() {
            if let Some(cover) = crate::aggregator::spotify::fetch_spotify_cover_image(&app, &query).await {
                artwork_url = cover;
            }
        }

        let mut tracks = Vec::new();
        tracks.push(ExternalTrack {
            id: format!("sp-{}", query),
            title,
            artist,
            album: "Spotify".to_string(),
            duration_ms: 0,
            artwork_url,
            source: "spotify".to_string(),
            stream_url: Some(query.clone()),
        });
        return Ok(tracks);
    }

    if source == "soundcloud" {
        return crate::aggregator::soundcloud::search(&app, &query, page).await;
    }

    if source == "spotify" {
        return search_spotify(&app, &query, page).await;
    }

    search_youtube(&app, &query, page).await
}

/// Parse a YouTube duration string like "3:45" or "1:02:30" into milliseconds
pub fn parse_yt_duration(s: &str) -> u64 {
    let parts: Vec<u64> = s.split(':').filter_map(|p| p.parse().ok()).collect();
    match parts.len() {
        1 => parts[0] * 1000,
        2 => (parts[0] * 60 + parts[1]) * 1000,
        3 => (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000,
        _ => 0,
    }
}

/// Filter out non-music content like podcasts, interviews, vlogs, reactions, gameplay, tutorials, and long/short non-music videos
pub fn is_music_track(title: &str, artist: &str, duration_ms: u64) -> bool {
    let lower_title = title.to_lowercase();
    let lower_artist = artist.to_lowercase();

    // 1. Duration filters
    // Short video filter: videos < 90 seconds (90,000 ms) are usually shorts, teasers, reels, sound effects, or speech snippets (unless 0 ms / unknown)
    if duration_ms > 0 && duration_ms < 90 * 1000 {
        let is_short_music = lower_title.contains("skit") || lower_title.contains("interlude") || lower_title.contains("intro") || lower_title.contains("outro");
        if !is_short_music {
            return false;
        }
    }

    // Long video filter: videos > 15 minutes (900,000 ms) are usually podcasts/vlogs/compilations, not single tracks
    if duration_ms > 15 * 60 * 1000 {
        let is_album_or_mix = lower_title.contains("full album") 
            || lower_title.contains("discography") 
            || lower_title.contains("extended mix") 
            || lower_title.contains("dj mix") 
            || lower_title.contains("compilation") 
            || lower_title.contains("medley") 
            || lower_title.contains("soundtrack") 
            || lower_title.contains("ost") 
            || lower_title.contains("symphony")
            || lower_title.contains("concerto")
            || lower_title.contains("live set");
        if !is_album_or_mix {
            return false;
        }
    }

    // 2. Comprehensive non-music negative keywords
    let non_music_keywords = [
        // Podcast, Talks & Speech
        "podcast", "podcasts", "interview", "interviews", "discussion", "talk show", "talkshow",
        "speech", "keynote", "presentation", "lecture", "sermon", "preaching", "panel", "q&a",
        "q & a", "qa video", "storytime", "story time", "asmr", "whispering", "audiobook", "audio book",

        // Gaming & Playthroughs
        "gameplay", "walkthrough", "playthrough", "let's play", "lets play", "livestream",
        "stream highlight", "stream highlights", "full game", "cutscene", "cutscenes", "speedrun",
        "game guide", "kill montage", "highlight reel", "fragmovie", "vtuber",

        // Reactions, Reviews & Commentary
        "reaction", "reacting", "reacts", "response to", "commentary", "opinion", "thoughts on",
        "tier list", "ranking", "criticism", "drama", "breakdown", "review", "unboxing",
        "hands-on", "hands on", "comparison",

        // Vlogs & Media Production
        "vlog", "daily vlog", "travel vlog", "behind the scenes", "bts", "making of", "making-of",
        "bloopers", "outtakes", "skit", "parody", "prank", "comedy",

        // News, TV & Movies
        "full movie", "trailer", "teaser", "episode", "ep.", "season", "film", "short film",
        "scene", "clip", "highlight", "news", "documentary", "report", "breaking news", "tv show",

        // Tutorials & Education
        "tutorial", "how to", "howto", "lesson", "course", "explained", "explanation",
        "analysis", "guide", "tips and tricks", "tips & tricks",

        // Sound Effects & Non-music Audio
        "sound effect", "sound effects", "sfx", "voice clip", "voiceline", "voice lines",
        "ringtone", "alarm sound", "alarm tone", "white noise", "nature sounds"
    ];

    for kw in &non_music_keywords {
        if lower_title.contains(kw) || lower_artist.contains(kw) {
            return false;
        }
    }

    true
}

/// Calculate exact keyword query relevance to prevent search algorithms from auto-correcting unique track names like "hangova" to "hangover"
pub fn calculate_query_relevance(title: &str, artist: &str, query: &str) -> i32 {
    let lower_title = title.to_lowercase();
    let lower_artist = artist.to_lowercase();
    let lower_query = query.to_lowercase().trim().to_string();

    if lower_query.is_empty() {
        return 0;
    }

    let mut score = 0;

    // 1. Exact title match (e.g. title is "hangova")
    if lower_title == lower_query {
        score += 3000;
    }

    // 2. Exact word match in title (e.g. word "hangova" exists as a separate word)
    let words: Vec<&str> = lower_title.split(|c: char| !c.is_alphanumeric()).collect();
    if words.contains(&lower_query.as_str()) {
        score += 1500;
    }

    // 3. Substring match in title
    if lower_title.contains(&lower_query) {
        score += 800;
    } else {
        // Severe penalty for auto-corrected mismatch (e.g., query is "hangova" but title is "hangover")
        score -= 1000;
    }

    // 4. Exact match in artist name
    if lower_artist.contains(&lower_query) {
        score += 400;
    }

    score
}

/// Calculate a quality score for a music track candidate (higher = better official music source)
pub fn score_music_track(title: &str, artist: &str, raw_artist: &str, duration_ms: u64) -> i32 {
    if !is_music_track(title, raw_artist, duration_ms) {
        return -1000;
    }

    let lower_title = title.to_lowercase();
    let lower_artist = artist.to_lowercase();
    let lower_raw = raw_artist.to_lowercase();

    let mut score = 10;

    let is_topic_channel = lower_raw.ends_with(" - topic") || lower_raw.ends_with("-topic") || lower_raw.contains("topic");
    let is_official_audio = lower_title.contains("official audio") || lower_title.contains("audio track") || lower_title.contains("provided to youtube");
    let is_video_song_or_mv = lower_title.contains("official video") || lower_title.contains("music video") || lower_title.contains("video song") || lower_title.contains("movie");

    // 1. Top priority (+500): Static Album Art Video (Topic channels & Official Audio uploads)
    if is_topic_channel {
        score += 500; // YouTube Music auto-generated Topic channel (100% static album art video)
    } else if is_official_audio && !is_video_song_or_mv {
        score += 400; // Official audio upload with static album cover
    }

    // 2. High priority: VEVO or Official Record Label channels
    if lower_raw.contains("vevo") || lower_raw.contains("official") || lower_raw.contains("records") || lower_raw.contains("music") || lower_artist.contains("vevo") {
        score += 50;
    }

    // 3. Audio & Visualizer indicators
    if lower_title.contains("official audio") {
        score += 60;
    } else if lower_title.contains("visualizer") || lower_title.contains("lyric video") {
        score += 40;
    } else if is_video_song_or_mv {
        score += 15;
    }

    // 4. Standard full song duration bonus (2 to 10 minutes)
    if duration_ms >= 120 * 1000 && duration_ms <= 600 * 1000 {
        score += 50;
    }

    score
}

/// Clean YouTube title noise (e.g. "| Video Song", "| Lyrical Video Song", "| Official Video")
pub fn clean_yt_title(title: &str) -> String {
    let mut cleaned = title.to_string();

    let noise_patterns = [
        "| video song", "| lyrical video song", "| lyrical video", "| official video",
        "| full video song", "| 4k video song", "| 8k video song", "| hd video song",
        "| official audio", "| lyric video", "| audio song", "- video song",
        "- lyrical video", "(video song)", "(lyrical video)", "(official video)",
        "(official audio)", "(full song)", "video song", "lyrical video song"
    ];

    for pat in &noise_patterns {
        let lower = cleaned.to_lowercase();
        if let Some(pos) = lower.find(pat) {
            cleaned.truncate(pos);
        }
    }

    cleaned.trim_matches(|c: char| c == '|' || c == '-' || c == ' ' || c == ':' || c == '(' || c == ')').trim().to_string()
}

/// Search YouTube by scraping the search results page HTML for ytInitialData JSON.
/// This bypasses rusty_ytdl's broken search parser entirely.
async fn search_youtube(_app: &tauri::AppHandle, query: &str, page: u32) -> Result<Vec<ExternalTrack>, String> {
    let per_page = 25usize;
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/131.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    // Enhance query to fetch official music audio tracks if it's a search term (not a direct URL)
    let query_lower = query.to_lowercase();
    let is_url = query.starts_with("http://") || query.starts_with("https://") || query.contains("youtube.com/") || query.contains("youtu.be/");
    let music_query = if is_url || query_lower.contains("audio") || query_lower.contains("song") || query_lower.contains("lyrics") || query_lower.contains("official") || query_lower.contains("music") {
        query.to_string()
    } else {
        format!("{} official audio song", query)
    };

    let url = format!(
        "https://www.youtube.com/results?search_query={}",
        urlencoding::encode(&music_query)
    );

    let html = client.get(&url)
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Cookie", "CONSENT=YES+cb.20210328-17-p0.en+FX+634")
        .send().await.map_err(|e| format!("YouTube search request failed: {}", e))?
        .text().await.map_err(|e| format!("YouTube search body read failed: {}", e))?;

    // Extract ytInitialData JSON from the HTML
    let marker = "var ytInitialData = ";
    let start = html.find(marker)
        .ok_or_else(|| "YouTube search: could not find ytInitialData in page".to_string())?;
    let json_start = start + marker.len();
    let json_end = html[json_start..].find(";</script>")
        .ok_or_else(|| "YouTube search: could not find end of ytInitialData".to_string())?;
    let json_str = &html[json_start..json_start + json_end];

    let data: Value = serde_json::from_str(json_str)
        .map_err(|e| format!("YouTube search: failed to parse ytInitialData: {}", e))?;

    // Navigate the deeply nested YouTube response structure
    let contents = data
        .pointer("/contents/twoColumnSearchResultsRenderer/primaryContents/sectionListRenderer/contents")
        .and_then(|c| c.as_array());

    let items = contents
        .and_then(|sections| {
            sections.iter().find_map(|s| {
                s.pointer("/itemSectionRenderer/contents").and_then(|c| c.as_array())
            })
        });

    let mut tracks = Vec::new();
    let skip = page as usize * per_page;

    if let Some(items) = items {
        for item in items {
            if let Some(renderer) = item.get("videoRenderer") {
                let video_id = renderer["videoId"].as_str().unwrap_or_default();
                if video_id.is_empty() { continue; }

                let raw_title = renderer.pointer("/title/runs/0/text")
                    .and_then(|t| t.as_str())
                    .unwrap_or_default();

                let raw_artist = renderer.pointer("/ownerText/runs/0/text")
                    .and_then(|a| a.as_str())
                    .unwrap_or("Unknown");

                let duration_text = renderer.pointer("/lengthText/simpleText")
                    .and_then(|d| d.as_str())
                    .unwrap_or("0:00");
                let duration_ms = parse_yt_duration(duration_text);

                // Filter out non-music content
                if !is_music_track(raw_title, raw_artist, duration_ms) {
                    continue;
                }

                let clean_title = clean_yt_title(raw_title);
                let title = if clean_title.is_empty() { raw_title.to_string() } else { clean_title };

                let artist = raw_artist
                    .replace(" - Topic", "")
                    .replace(" - TOPIC", "")
                    .trim()
                    .to_string();

                let artwork_url = renderer.pointer("/thumbnail/thumbnails")
                    .and_then(|t| t.as_array())
                    .and_then(|arr| arr.last())
                    .and_then(|t| t["url"].as_str())
                    .unwrap_or_default()
                    .to_string();

                let score = score_music_track(raw_title, &artist, raw_artist, duration_ms) + calculate_query_relevance(raw_title, &artist, query);

                tracks.push((
                    ExternalTrack {
                        id: format!("yt-{}", video_id),
                        title,
                        artist,
                        album: "YouTube".to_string(),
                        duration_ms,
                        artwork_url,
                        source: "youtube".to_string(),
                        stream_url: None,
                    },
                    score
                ));
            }
        }
    }

    // Sort tracks by quality & query relevance score descending
    tracks.sort_by_key(|t| std::cmp::Reverse(t.1));
    let sorted_tracks: Vec<ExternalTrack> = tracks.into_iter().map(|(t, _)| t).collect();

    // Handle pagination by skipping already-seen results
    if skip >= sorted_tracks.len() {
        return Ok(Vec::new());
    }
    let paged: Vec<ExternalTrack> = sorted_tracks.into_iter().skip(skip).take(per_page).collect();
    Ok(paged)
}

async fn search_spotify(app: &tauri::AppHandle, query: &str, page: u32) -> Result<Vec<ExternalTrack>, String> {
    // 1. Try Spotify Official Web API via anonymous bearer token
    if let Some(token) = crate::aggregator::spotify::get_spotify_token().await {
        let offset = page * 25;
        let url = format!(
            "https://api.spotify.com/v1/search?q={}&type=track&limit=25&offset={}",
            urlencoding::encode(query),
            offset
        );

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(4))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default();

        if let Ok(resp) = client.get(&url).header("Authorization", format!("Bearer {}", token)).send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(items) = json["tracks"]["items"].as_array() {
                    let mut tracks = Vec::new();
                    for item in items {
                        let id = item["id"].as_str().unwrap_or("").to_string();
                        let title = item["name"].as_str().unwrap_or("").to_string();
                        let artist = item["artists"][0]["name"].as_str().unwrap_or("Unknown Artist").to_string();
                        let album = item["album"]["name"].as_str().unwrap_or("").to_string();
                        let artwork_url = item["album"]["images"].as_array().and_then(|arr| arr.first()).and_then(|i| i["url"].as_str()).unwrap_or("").to_string();
                        let duration_ms = item["duration_ms"].as_u64().unwrap_or(0);
                        let spotify_url = item["external_urls"]["spotify"].as_str().unwrap_or("").to_string();

                        if !id.is_empty() && !title.is_empty() {
                            tracks.push(ExternalTrack {
                                id: format!("sp-{}", id),
                                title,
                                artist,
                                album,
                                duration_ms,
                                artwork_url,
                                source: "spotify".to_string(),
                                stream_url: if spotify_url.is_empty() {
                                    Some(format!("https://open.spotify.com/track/{}", id))
                                } else {
                                    Some(spotify_url)
                                },
                            });
                        }
                    }
                    if !tracks.is_empty() {
                        // Sort Spotify search results by exact query relevance
                        tracks.sort_by_key(|t| std::cmp::Reverse(calculate_query_relevance(&t.title, &t.artist, query)));
                        println!("Spotify Web API: Found {} tracks for '{}'", tracks.len(), query);
                        return Ok(tracks);
                    }
                }
            }
        }
    }

    // 2. Try spotiflac-cli sidecar search
    let sidecar_tracks = search_spotify_sidecar(app, query, page).await.unwrap_or_default();
    if !sidecar_tracks.is_empty() {
        return Ok(sidecar_tracks);
    }

    // 3. Robust Fallback: Query iTunes search API and enrich with high quality Spotify album covers
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_default();

    let itunes_url = format!("https://itunes.apple.com/search?term={}&media=music&limit=25", urlencoding::encode(query));
    if let Ok(resp) = client.get(&itunes_url).send().await {
        if let Ok(json) = resp.json::<Value>().await {
            if let Some(results) = json["results"].as_array() {
                let mut tracks = Vec::new();
                for item in results {
                    let title = item["trackName"].as_str().unwrap_or("").to_string();
                    let artist = item["artistName"].as_str().unwrap_or("").to_string();
                    let album = item["collectionName"].as_str().unwrap_or("").to_string();
                    let duration_ms = item["trackTimeMillis"].as_u64().unwrap_or(0);
                    let mut artwork_url = item["artworkUrl100"].as_str().unwrap_or("").replace("100x100bb", "600x600bb");

                    if !title.is_empty() {
                        if let Some(sp_cover) = crate::aggregator::spotify::fetch_spotify_cover_image(app, &format!("{} {}", title, artist)).await {
                            artwork_url = sp_cover;
                        }

                        tracks.push(ExternalTrack {
                            id: format!("sp-{}-{}", title.to_lowercase().replace(' ', "-"), artist.to_lowercase().replace(' ', "-")),
                            title,
                            artist,
                            album,
                            duration_ms,
                            artwork_url,
                            source: "spotify".to_string(),
                            stream_url: None,
                        });
                    }
                }
                if !tracks.is_empty() {
                    println!("Spotify Fallback API: Found {} tracks for '{}'", tracks.len(), query);
                    return Ok(tracks);
                }
            }
        }
    }

    Ok(Vec::new())
}

async fn search_spotify_sidecar(app: &tauri::AppHandle, query: &str, page: u32) -> Result<Vec<ExternalTrack>, String> {
    use tauri_plugin_shell::ShellExt;

    println!("Spotify Sidecar: Searching for: {}", query);

    let cmd = match app.shell().sidecar("spotiflac-cli") {
        Ok(c) => c,
        Err(_) => return Ok(Vec::new()),
    };

    let offset = page * 20;
    let search_arg = if offset > 0 {
        format!("SEARCH:{}", offset)
    } else {
        "SEARCH".to_string()
    };
    let output = match cmd.args([query, &search_arg]).output().await {
        Ok(out) => out,
        Err(_) => return Ok(Vec::new()),
    };

    let out_str = String::from_utf8_lossy(&output.stdout);

    let json_str = out_str.lines()
        .filter(|l| l.trim().starts_with('{'))
        .last()
        .unwrap_or("");

    if json_str.is_empty() {
        return Ok(Vec::new());
    }

    let parsed: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return Ok(Vec::new()),
    };

    if parsed["success"].as_bool() != Some(true) {
        return Ok(Vec::new());
    }

    let mut tracks = Vec::new();
    if let Some(results) = parsed["tracks"].as_array() {
        for item in results {
            let id = item["id"].as_str().unwrap_or("").to_string();
            let name = item["name"].as_str().unwrap_or("Unknown").to_string();
            let artists = item["artists"].as_str().unwrap_or("Unknown Artist").to_string();
            let album = item["album_name"].as_str().unwrap_or("").to_string();
            let cover = item["images"].as_str().unwrap_or("").to_string();
            let duration_ms = item["duration_ms"].as_u64().unwrap_or(0);
            let external_url = item["external_urls"].as_str().unwrap_or("").to_string();

            if id.is_empty() { continue; }

            tracks.push(ExternalTrack {
                id: format!("sp-{}", id),
                title: name,
                artist: artists,
                album,
                duration_ms,
                artwork_url: cover,
                source: "spotify".to_string(),
                stream_url: if external_url.is_empty() {
                    Some(format!("https://open.spotify.com/track/{}", id))
                } else {
                    Some(external_url)
                },
            });
        }
    }

    Ok(tracks)
}
