use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashSet, HashMap};
use tauri::AppHandle;


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NewsTrack {
    pub title: String,
    pub artist: String,
    pub artwork_url: String,
    pub url: String,
    pub release_date: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NewsPlaylist {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub artwork_url: String,
    pub r#type: String, // "playlist" or "album"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NewsResponse {
    pub songs: Vec<NewsTrack>,
    pub playlists: Vec<NewsPlaylist>,
}

#[derive(Debug, Clone)]
pub struct TasteProfile {
    pub favorite_artists: Vec<String>,
    pub languages: Vec<String>,
    pub genres: Vec<String>,
}

pub fn analyze_listener_taste(app: &AppHandle, recent_plays: &Option<Vec<String>>) -> TasteProfile {
    let mut artist_counts: HashMap<String, usize> = HashMap::new();
    let mut text_corpus = String::new();

    // 1. Liked tracks analysis
    let liked = crate::offline::get_liked_tracks_sync(app);
    for t in &liked {
        let clean_artist = t.artist.trim().to_string();
        if !clean_artist.is_empty() && clean_artist != "Unknown Artist" {
            *artist_counts.entry(clean_artist.clone()).or_insert(0) += 3;
        }
        text_corpus.push_str(&format!(" {} {} ", t.title, t.artist));
    }

    // 2. Recent plays analysis
    if let Some(ref recent) = recent_plays {
        for rp in recent {
            text_corpus.push_str(&format!(" {} ", rp));
        }
    }

    let corpus_lower = text_corpus.to_lowercase();

    // Extract top artists
    let mut sorted_artists: Vec<_> = artist_counts.into_iter().collect();
    sorted_artists.sort_by(|a, b| b.1.cmp(&a.1));
    let mut favorite_artists: Vec<String> = sorted_artists.into_iter().map(|(art, _)| art).collect();

    if favorite_artists.is_empty() {
        favorite_artists = vec![
            "Anirudh Ravichander".to_string(),
            "The Weeknd".to_string(),
            "A.R. Rahman".to_string(),
            "Jakes Bejoy".to_string(),
            "Taylor Swift".to_string(),
            "Billie Eilish".to_string(),
        ];
    }

    // Language Interests Detection
    let lang_rules = [
        ("Tamil", vec!["anirudh", "rahman", "santhosh narayanan", "yuvan", "harris jayaraj", "ilayaraja", "gv prakash", "hiphop tamizha", "tamil", "kollywood", "sid sriram", "arunraja"]),
        ("Malayalam", vec!["jakes bejoy", "sushin shyam", "hesnam abdul wahab", "shaan rahman", "gopi sundar", "vidyasagar", "malayalam", "mollywood", "job kurian", "fejo"]),
        ("Hindi", vec!["arijit", "pritam", "shreya ghoshal", "badshah", "neha kakkar", "vishal-shekhar", "mithoon", "hindi", "bollywood", "jubin", "tanishk"]),
        ("Telugu", vec!["thaman", "dsp", "devi sri prasad", "keeravani", "telugu", "tollywood", "sid sriram"]),
        ("Punjabi", vec!["karan aujla", "diljit", "ap dhillon", "shubh", "sidhu moose wala", "punjabi", "harnoor"]),
        ("Korean", vec!["bts", "blackpink", "newjeans", "stray kids", "twice", "kpop", "k-pop", "exo", "seventeen"]),
        ("Japanese", vec!["yoasobi", "kenshi yonezu", "lisa", "jpop", "j-pop", "anime", "radwimps"]),
    ];

    let mut languages = Vec::new();
    for (lang, kws) in &lang_rules {
        if kws.iter().any(|kw| corpus_lower.contains(kw)) {
            languages.push(lang.to_string());
        }
    }
    if languages.is_empty() {
        languages.push("Tamil".to_string());
        languages.push("Hindi".to_string());
    }

    // Genre & Style Interests Detection
    let genre_rules = [
        ("Lofi", vec!["lofi", "lo-fi", "chillhop", "study beats", "relaxing"]),
        ("Synthwave", vec!["synthwave", "retrowave", "cyberpunk", "phonk", "drift"]),
        ("Hip Hop", vec!["hiphop", "hip hop", "rap", "trap", "r&b"]),
        ("Acoustic", vec!["acoustic", "unplugged", "guitar", "piano", "indie"]),
        ("EDM", vec!["edm", "remix", "dance", "electronic", "house", "club"]),
        ("Cinematic BGM", vec!["bgm", "ost", "theme", "score", "epic", "soundtrack"]),
    ];

    let mut genres = Vec::new();
    for (genre, kws) in &genre_rules {
        if kws.iter().any(|kw| corpus_lower.contains(kw)) {
            genres.push(genre.to_string());
        }
    }
    if genres.is_empty() {
        genres.push("Cinematic BGM".to_string());
        genres.push("Synthwave".to_string());
    }

    TasteProfile {
        favorite_artists,
        languages,
        genres,
    }
}

#[tauri::command]
pub async fn get_music_news(app: AppHandle, recent_plays: Option<Vec<String>>) -> Result<NewsResponse, String> {
    // 1. Analyze listener's multi-factor taste profile (artists, language interests, genres, styles)
    let taste = analyze_listener_taste(&app, &recent_plays);

    // Try to fetch trending & new releases from JioSaavn first, personalized to their taste languages
    if let Ok(saavn_data) = fetch_jiosaavn_news(&taste.languages).await {
        if !saavn_data.songs.is_empty() || !saavn_data.playlists.is_empty() {
            return Ok(saavn_data);
        }
    }

    let mut tracks = Vec::new();
    let mut seen = HashSet::new();

    // 2. Get Spotify Bearer Token
    let token = crate::aggregator::spotify::get_spotify_token().await;

    if let Some(ref token) = token {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default();

        let mut artist_tracks = Vec::new();
        let mut language_tracks = Vec::new();
        let mut genre_tracks = Vec::new();
        let mut global_tracks = Vec::new();

        // Step A: Fetch Favorite Artist Tracks (Parallel)
        let artist_futures: Vec<_> = taste.favorite_artists.iter().take(4).map(|artist| {
            let client_clone = client.clone();
            let token_clone = token.clone();
            let search_url = format!(
                "https://api.spotify.com/v1/search?q={}&type=track&limit=4",
                urlencoding::encode(&format!("artist:{}", artist))
            );
            async move {
                let mut res = Vec::new();
                if let Ok(resp) = client_clone.get(&search_url).header("Authorization", format!("Bearer {}", token_clone)).send().await {
                    if let Ok(json) = resp.json::<Value>().await {
                        if let Some(items) = json["tracks"]["items"].as_array() {
                            for item in items {
                                let title = item["name"].as_str().unwrap_or("").to_string();
                                let artist_name = item["artists"][0]["name"].as_str().unwrap_or("").to_string();
                                let artwork = item["album"]["images"].as_array().and_then(|arr| arr.first()).and_then(|i| i["url"].as_str()).unwrap_or("").to_string();
                                let release_date = item["album"]["release_date"].as_str().unwrap_or("2026").to_string();
                                let spotify_url = item["external_urls"]["spotify"].as_str().unwrap_or("").to_string();

                                if !title.is_empty() && !artwork.is_empty() {
                                    res.push(NewsTrack {
                                        title,
                                        artist: artist_name,
                                        artwork_url: artwork,
                                        url: spotify_url,
                                        release_date: format!("For You • {}", release_date),
                                    });
                                }
                            }
                        }
                    }
                }
                res
            }
        }).collect();

        // Step B: Fetch Language Interest Tracks (Parallel)
        let lang_futures: Vec<_> = taste.languages.iter().take(3).map(|lang| {
            let client_clone = client.clone();
            let token_clone = token.clone();
            let lang_query = format!("{} hits 2026", lang);
            let search_url = format!(
                "https://api.spotify.com/v1/search?q={}&type=track&limit=5",
                urlencoding::encode(&lang_query)
            );
            let lang_label = lang.clone();
            async move {
                let mut res = Vec::new();
                if let Ok(resp) = client_clone.get(&search_url).header("Authorization", format!("Bearer {}", token_clone)).send().await {
                    if let Ok(json) = resp.json::<Value>().await {
                        if let Some(items) = json["tracks"]["items"].as_array() {
                            for item in items {
                                let title = item["name"].as_str().unwrap_or("").to_string();
                                let artist_name = item["artists"][0]["name"].as_str().unwrap_or("").to_string();
                                let artwork = item["album"]["images"].as_array().and_then(|arr| arr.first()).and_then(|i| i["url"].as_str()).unwrap_or("").to_string();
                                let release_date = item["album"]["release_date"].as_str().unwrap_or("2026").to_string();
                                let spotify_url = item["external_urls"]["spotify"].as_str().unwrap_or("").to_string();

                                if !title.is_empty() && !artwork.is_empty() {
                                    res.push(NewsTrack {
                                        title,
                                        artist: artist_name,
                                        artwork_url: artwork,
                                        url: spotify_url,
                                        release_date: format!("{} Hit • {}", lang_label, release_date),
                                    });
                                }
                            }
                        }
                    }
                }
                res
            }
        }).collect();

        // Step C: Fetch Genre & Music Style Tracks (Parallel)
        let genre_futures: Vec<_> = taste.genres.iter().take(3).map(|genre| {
            let client_clone = client.clone();
            let token_clone = token.clone();
            let search_url = format!(
                "https://api.spotify.com/v1/search?q={}&type=track&limit=5",
                urlencoding::encode(&format!("genre:\"{}\"", genre))
            );
            let genre_label = genre.clone();
            async move {
                let mut res = Vec::new();
                if let Ok(resp) = client_clone.get(&search_url).header("Authorization", format!("Bearer {}", token_clone)).send().await {
                    if let Ok(json) = resp.json::<Value>().await {
                        if let Some(items) = json["tracks"]["items"].as_array() {
                            for item in items {
                                let title = item["name"].as_str().unwrap_or("").to_string();
                                let artist_name = item["artists"][0]["name"].as_str().unwrap_or("").to_string();
                                let artwork = item["album"]["images"].as_array().and_then(|arr| arr.first()).and_then(|i| i["url"].as_str()).unwrap_or("").to_string();
                                let release_date = item["album"]["release_date"].as_str().unwrap_or("2026").to_string();
                                let spotify_url = item["external_urls"]["spotify"].as_str().unwrap_or("").to_string();

                                if !title.is_empty() && !artwork.is_empty() {
                                    res.push(NewsTrack {
                                        title,
                                        artist: artist_name,
                                        artwork_url: artwork,
                                        url: spotify_url,
                                        release_date: format!("{} • {}", genre_label, release_date),
                                    });
                                }
                            }
                        }
                    }
                }
                res
            }
        }).collect();

        // Step D: Fetch Spotify Global New Releases
        let client_b = client.clone();
        let token_b = token.clone();
        let global_future = async move {
            let mut res = Vec::new();
            let url = "https://api.spotify.com/v1/browse/new-releases?limit=15";
            if let Ok(resp) = client_b.get(url).header("Authorization", format!("Bearer {}", token_b)).send().await {
                if let Ok(json) = resp.json::<Value>().await {
                    if let Some(albums) = json["albums"]["items"].as_array() {
                        for album in albums {
                            let title = album["name"].as_str().unwrap_or("").to_string();
                            let artist_name = album["artists"][0]["name"].as_str().unwrap_or("").to_string();
                            let artwork = album["images"].as_array().and_then(|arr| arr.first()).and_then(|i| i["url"].as_str()).unwrap_or("").to_string();
                            let release_date = album["release_date"].as_str().unwrap_or("2026").to_string();
                            let spotify_url = album["external_urls"]["spotify"].as_str().unwrap_or("").to_string();

                            if !title.is_empty() && !artwork.is_empty() {
                                res.push(NewsTrack {
                                    title,
                                    artist: artist_name,
                                    artwork_url: artwork,
                                    url: spotify_url,
                                    release_date: format!("New Release • {}", release_date),
                                });
                            }
                        }
                    }
                }
            }
            res
        };

        // Run ALL requests concurrently in parallel!
        let (artist_res, lang_res, genre_res, global_res) = tokio::join!(
            futures::future::join_all(artist_futures),
            futures::future::join_all(lang_futures),
            futures::future::join_all(genre_futures),
            global_future
        );

        // Deduplicate and gather into category buckets
        for sub in artist_res {
            for track in sub {
                let key = format!("{} - {}", track.title.to_lowercase(), track.artist.to_lowercase());
                if !seen.contains(&key) {
                    seen.insert(key);
                    artist_tracks.push(track);
                }
            }
        }

        for sub in lang_res {
            for track in sub {
                let key = format!("{} - {}", track.title.to_lowercase(), track.artist.to_lowercase());
                if !seen.contains(&key) {
                    seen.insert(key);
                    language_tracks.push(track);
                }
            }
        }

        for sub in genre_res {
            for track in sub {
                let key = format!("{} - {}", track.title.to_lowercase(), track.artist.to_lowercase());
                if !seen.contains(&key) {
                    seen.insert(key);
                    genre_tracks.push(track);
                }
            }
        }

        for track in global_res {
            let key = format!("{} - {}", track.title.to_lowercase(), track.artist.to_lowercase());
            if !seen.contains(&key) {
                seen.insert(key);
                global_tracks.push(track);
            }
        }

        // Interleave categories (Artist Taste -> Language Interest -> Genre Style -> Global Trending)
        let mut ai = 0;
        let mut li = 0;
        let mut gi = 0;
        let mut gl_i = 0;

        while ai < artist_tracks.len() || li < language_tracks.len() || gi < genre_tracks.len() || gl_i < global_tracks.len() {
            if ai < artist_tracks.len() {
                tracks.push(artist_tracks[ai].clone());
                ai += 1;
            }
            if li < language_tracks.len() {
                tracks.push(language_tracks[li].clone());
                li += 1;
            }
            if gi < genre_tracks.len() {
                tracks.push(genre_tracks[gi].clone());
                gi += 1;
            }
            if gl_i < global_tracks.len() {
                tracks.push(global_tracks[gl_i].clone());
                gl_i += 1;
            }
        }
    }

    if tracks.is_empty() {
        tracks = fetch_fallback_news().await;
    }

    Ok(NewsResponse {
        songs: tracks,
        playlists: Vec::new(), // Spotify fallback doesn't fetch playlists yet
    })
}

async fn fetch_fallback_news() -> Vec<NewsTrack> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_default();

    let url = "https://itunes.apple.com/us/rss/topsongs/limit=15/json";
    if let Ok(resp) = client.get(url).send().await {
        if let Ok(json) = resp.json::<Value>().await {
            let mut tracks = Vec::new();
            if let Some(entries) = json["feed"]["entry"].as_array() {
                for entry in entries {
                    let title = entry["im:name"]["label"].as_str().unwrap_or("").to_string();
                    let artist = entry["im:artist"]["label"].as_str().unwrap_or("").to_string();
                    let artwork = entry["im:image"]
                        .as_array()
                        .and_then(|arr| arr.last())
                        .and_then(|img| img["label"].as_str())
                        .unwrap_or("")
                        .to_string();
                    
                    if !title.is_empty() && !artist.is_empty() {
                        tracks.push(NewsTrack {
                            title,
                            artist,
                            artwork_url: artwork,
                            url: String::new(),
                            release_date: "Trending".to_string(),
                        });
                    }
                }
                if !tracks.is_empty() {
                    return tracks;
                }
            }
        }
    }
    get_hardcoded_news()
}

fn get_hardcoded_news() -> Vec<NewsTrack> {
    vec![
        NewsTrack {
            title: "Badass (From 'Leo')".to_string(),
            artist: "Anirudh Ravichander".to_string(),
            artwork_url: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400".to_string(),
            url: "".to_string(),
            release_date: "Trending".to_string(),
        },
        NewsTrack {
            title: "Kaavaalaa (From 'Jailer')".to_string(),
            artist: "Anirudh Ravichander, Shilpa Rao".to_string(),
            artwork_url: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400".to_string(),
            url: "".to_string(),
            release_date: "Trending".to_string(),
        },
        NewsTrack {
            title: "Blinding Lights".to_string(),
            artist: "The Weeknd".to_string(),
            artwork_url: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400".to_string(),
            url: "".to_string(),
            release_date: "Trending".to_string(),
        },
        NewsTrack {
            title: "Shape of You".to_string(),
            artist: "Ed Sheeran".to_string(),
            artwork_url: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=400".to_string(),
            url: "".to_string(),
            release_date: "Trending".to_string(),
        },
        NewsTrack {
            title: "Flowers".to_string(),
            artist: "Miley Cyrus".to_string(),
            artwork_url: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=400".to_string(),
            url: "".to_string(),
            release_date: "Trending".to_string(),
        },
        NewsTrack {
            title: "Stay".to_string(),
            artist: "The Kid LAROI, Justin Bieber".to_string(),
            artwork_url: "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=400".to_string(),
            url: "".to_string(),
            release_date: "Trending".to_string(),
        },
    ]
}

async fn fetch_jiosaavn_news(languages: &[String]) -> Result<NewsResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    // Personalized regional targeting: Build language string (e.g. tamil,malayalam,english) and inject into JioSaavn's language cookie 'L'
    let mut langs = languages.iter().map(|l| l.to_lowercase()).collect::<Vec<String>>();
    if !langs.contains(&"english".to_string()) {
        langs.push("english".to_string());
    }
    let cookie_val = urlencoding::encode(&langs.join(",")).into_owned();
    let cookie_header = format!("L={}", cookie_val);

    let url = "https://www.jiosaavn.com/api.php?__call=webapi.getLaunchData&api_version=4&_format=json&_marker=0&ctx=web";
    let resp = client.get(url)
        .header("cookie", cookie_header)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: Value = resp.json().await.map_err(|e| e.to_string())?;

    let mut tracks = Vec::new();
    let mut playlists = Vec::new();

    let decode = |s: &str| -> String {
        s.replace("&quot;", "\"")
         .replace("&amp;", "&")
         .replace("&#039;", "'")
         .replace("&apos;", "'")
         .replace("&lt;", "<")
         .replace("&gt;", ">")
    };

    if let Some(trending) = json["new_trending"].as_array() {
        for item in trending {
            let item_type = item["type"].as_str().unwrap_or("");
            let title = decode(item["title"].as_str().unwrap_or(""));
            let artwork_raw = item["image"].as_str().unwrap_or("").to_string();
            let artwork = artwork_raw.replace("150x150", "500x500");

            let mut artist_names = Vec::new();
            if let Some(artists) = item["more_info"]["artistMap"]["primary_artists"].as_array() {
                for artist in artists {
                    if let Some(name) = artist["name"].as_str() {
                        artist_names.push(decode(name));
                    }
                }
            } else if let Some(artists) = item["more_info"]["artistMap"]["artists"].as_array() {
                for artist in artists {
                    if let Some(name) = artist["name"].as_str() {
                        artist_names.push(decode(name));
                    }
                }
            }

            let subtitle = if artist_names.is_empty() {
                decode(item["subtitle"].as_str().unwrap_or(""))
            } else {
                artist_names.join(", ")
            };

            if title.is_empty() || artwork.is_empty() {
                continue;
            }

            if item_type == "song" {
                tracks.push(NewsTrack {
                    title,
                    artist: subtitle,
                    artwork_url: artwork,
                    url: String::new(),
                    release_date: "Trending".to_string(),
                });
            } else if item_type == "playlist" || item_type == "album" {
                playlists.push(NewsPlaylist {
                    id: item["id"].as_str().unwrap_or("").to_string(),
                    title,
                    subtitle,
                    artwork_url: artwork,
                    r#type: item_type.to_string(),
                });
            }
        }
    }

    if let Some(albums) = json["new_albums"].as_array() {
        for item in albums {
            let title = decode(item["title"].as_str().unwrap_or(""));
            let artwork_raw = item["image"].as_str().unwrap_or("").to_string();
            let artwork = artwork_raw.replace("150x150", "500x500");

            let mut artist_names = Vec::new();
            if let Some(artists) = item["more_info"]["artistMap"]["artists"].as_array() {
                for artist in artists {
                    if let Some(name) = artist["name"].as_str() {
                        artist_names.push(decode(name));
                    }
                }
            }

            let subtitle = if artist_names.is_empty() {
                decode(item["subtitle"].as_str().unwrap_or(""))
            } else {
                artist_names.join(", ")
            };

            if title.is_empty() || artwork.is_empty() {
                continue;
            }

            // Albums are essentially playlists here
            playlists.push(NewsPlaylist {
                id: item["id"].as_str().unwrap_or("").to_string(),
                title,
                subtitle,
                artwork_url: artwork,
                r#type: "album".to_string(),
            });
        }
    }

    Ok(NewsResponse {
        songs: tracks,
        playlists,
    })
}

#[tauri::command]
pub async fn fetch_jiosaavn_playlist(id: String, is_album: bool) -> Result<Vec<NewsTrack>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let url = if is_album {
        format!("https://www.jiosaavn.com/api.php?__call=content.getAlbumDetails&albumid={}&api_version=4&_format=json&_marker=0&ctx=web", id)
    } else {
        format!("https://www.jiosaavn.com/api.php?__call=playlist.getDetails&listid={}&api_version=4&_format=json&_marker=0&ctx=web", id)
    };

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let json: Value = resp.json().await.map_err(|e| e.to_string())?;

    let decode = |s: &str| -> String {
        s.replace("&quot;", "\"")
         .replace("&amp;", "&")
         .replace("&#039;", "'")
         .replace("&apos;", "'")
         .replace("&lt;", "<")
         .replace("&gt;", ">")
    };

    let mut tracks = Vec::new();

    let list = if is_album {
        json["list"].as_array()
    } else {
        json["list"].as_array()
    };

    if let Some(items) = list {
        for item in items {
            let title = decode(item["title"].as_str().unwrap_or(""));
            let artwork_raw = item["image"].as_str().unwrap_or("").to_string();
            let artwork = artwork_raw.replace("150x150", "500x500");

            let mut artist_names = Vec::new();
            if let Some(artists) = item["more_info"]["artistMap"]["primary_artists"].as_array() {
                for artist in artists {
                    if let Some(name) = artist["name"].as_str() {
                        artist_names.push(decode(name));
                    }
                }
            } else if let Some(artists) = item["more_info"]["artistMap"]["artists"].as_array() {
                for artist in artists {
                    if let Some(name) = artist["name"].as_str() {
                        artist_names.push(decode(name));
                    }
                }
            }

            let artist = if artist_names.is_empty() {
                decode(item["subtitle"].as_str().unwrap_or(""))
            } else {
                artist_names.join(", ")
            };

            if !title.is_empty() && !artwork.is_empty() {
                tracks.push(NewsTrack {
                    title,
                    artist,
                    artwork_url: artwork,
                    url: String::new(),
                    release_date: "Playlist Track".to_string(),
                });
            }
        }
    }

    Ok(tracks)
}
