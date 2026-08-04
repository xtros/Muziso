import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export async function fetchAlbumArt(title: string, artist: string): Promise<string | null> {
    try {
        const query = encodeURIComponent(`${title} ${artist}`);
        const res = await fetch(`https://itunes.apple.com/search?term=${query}&limit=1&media=music`);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            return data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
        }
    } catch (e) {
        console.warn("Failed to fetch album art from iTunes", e);
    }
    return null;
}

export type LyricsData = {
    syncedLyrics?: string;
    plainLyrics?: string;
};

export async function fetchLyrics(title: string, artist: string, album: string, durationMs: number, spotifyId?: string): Promise<LyricsData | null> {
    invoke('log_frontend', { msg: `fetchLyrics called! spotifyId=${spotifyId}, title=${title}, artist=${artist}` }).catch(() => { });
    try {
        if (spotifyId) {
            try {
                const spotifyLyrics = await invoke<{ synced_lyrics?: string, plain_lyrics?: string }>('get_spotify_lyrics', { trackId: spotifyId });
                if (spotifyLyrics && (spotifyLyrics.synced_lyrics || spotifyLyrics.plain_lyrics)) {
                    return {
                        syncedLyrics: spotifyLyrics.synced_lyrics || undefined,
                        plainLyrics: spotifyLyrics.plain_lyrics || undefined
                    };
                }
            } catch (e) {
                invoke('log_frontend', { msg: `IPC Invoke Failed for get_spotify_lyrics: ${e}` }).catch(() => { });
                console.warn("Native Spotify lyrics failed:", e);
            }
        }

        // Clean the artist name
        const cleanArtist = artist
            .replace(/\s*-\s*Topic/i, '')
            .replace(/\s*,\s*.*$/g, '') // Remove secondary artists
            .trim();

        // Clean the title
        let cleanTitle = title;
        
        // Remove content in parenthesis/brackets e.g. (Official Music Video), [Lyric Video]
        cleanTitle = cleanTitle.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
        // Clear any trailing unclosed parenthesis/brackets
        cleanTitle = cleanTitle.replace(/\s*[\(\[].*/g, '').trim();
        
        // Remove common garbage/promo/metadata words
        const garbage = [
            /official\s+music\s+video/i,
            /official\s+video/i,
            /official\s+audio/i,
            /official\s+lyric\s+video/i,
            /official\s+lyrics\s+video/i,
            /lyric\s+video/i,
            /lyrics\s+video/i,
            /music\s+video/i,
            /main\s+track/i,
            /lyric/i,
            /lyrics/i,
            /audio/i,
            /video/i,
            /visualizer/i,
            /hq/i,
            /hd/i,
            /4k/i,
            /1080p/i
        ];
        for (const pattern of garbage) {
            cleanTitle = cleanTitle.replace(pattern, '');
        }
        
        // Remove quotes
        cleanTitle = cleanTitle.replace(/['"“”‘’]/g, '');
        
        // Handle title containing the artist's name (e.g. "JENNIE - Less Than A Lover")
        const parts = cleanTitle.split(/\s+[-–—]\s+/);
        if (parts.length >= 2) {
            if (parts[0].toLowerCase().includes(cleanArtist.toLowerCase()) || cleanArtist.toLowerCase().includes(parts[0].toLowerCase())) {
                cleanTitle = parts.slice(1).join(' - ');
            } else if (parts[parts.length - 1].toLowerCase().includes(cleanArtist.toLowerCase()) || cleanArtist.toLowerCase().includes(parts[parts.length - 1].toLowerCase())) {
                cleanTitle = parts.slice(0, parts.length - 1).join(' - ');
            } else {
                cleanTitle = parts[0];
            }
        }
        
        // Clean multiple spaces and hyphens
        cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();
        cleanTitle = cleanTitle.replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();

        // Strategy 1: Exact match with clean metadata
        const url = new URL('https://lrclib.net/api/get');
        url.searchParams.append('track_name', cleanTitle);
        url.searchParams.append('artist_name', cleanArtist);
        if (album && !['youtube', 'soundcloud', 'bandcamp', 'vk', 'yandex', 'spotify'].includes(album.toLowerCase())) {
            url.searchParams.append('album_name', album);
        }
        if (durationMs > 0) {
            url.searchParams.append('duration', Math.floor(durationMs / 1000).toString());
        }

        const res = await fetch(url.toString());
        if (res.ok) {
            const data = await res.json();
            if (data.syncedLyrics || data.plainLyrics) {
                return { syncedLyrics: data.syncedLyrics, plainLyrics: data.plainLyrics };
            }
        }

        // Strategy 2: Search API with strict artist checking
        const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
        const searchRes = await fetch(searchUrl);
        if (searchRes.ok) {
            const results = await searchRes.json();
            if (Array.isArray(results) && results.length > 0) {
                // Prioritize entries where artist matches query artist to avoid wrong artist matches
                const artistMatch = results.filter((r: any) => {
                    const rArtist = (r.artistName || '').toLowerCase();
                    const qArtist = cleanArtist.toLowerCase();
                    return rArtist.includes(qArtist) || qArtist.includes(rArtist);
                });
                
                const candidates = artistMatch.length > 0 ? artistMatch : results;
                
                // Prefer synced lyrics
                const synced = candidates.find((r: any) => r.syncedLyrics);
                const best = synced || candidates[0];
                if (best.syncedLyrics || best.plainLyrics) {
                    return { syncedLyrics: best.syncedLyrics, plainLyrics: best.plainLyrics };
                }
            }
        }

        // Strategy 3: Fallback to Musixmatch
        console.log("Falling back to Musixmatch for:", cleanTitle, cleanArtist);
        try {
            const mxmLyrics = await invoke<{ synced_lyrics?: string, plain_lyrics?: string }>('get_musixmatch_lyrics', { title: cleanTitle, artist: cleanArtist });
            if (mxmLyrics && (mxmLyrics.synced_lyrics || mxmLyrics.plain_lyrics)) {
                return {
                    syncedLyrics: mxmLyrics.synced_lyrics || undefined,
                    plainLyrics: mxmLyrics.plain_lyrics || undefined
                };
            }
        } catch (mxmErr) {
            console.warn("Musixmatch scraper failed:", mxmErr);
        }

        // Strategy 4: Fallback to Genius Scraper
        console.log("Falling back to Genius for:", cleanTitle, cleanArtist);
        try {
            const geniusLyrics = await invoke<string>('get_genius_lyrics', { title: cleanTitle, artist: cleanArtist });
            if (geniusLyrics) {
                return { plainLyrics: geniusLyrics };
            }
        } catch (geniusErr) {
            console.warn("Genius scraper failed:", geniusErr);
        }

    } catch (e) {
        console.warn("Failed to fetch lyrics", e);
    }
    return null;
}

export function useAudioPlayer(getTracks: () => TrackData[], onEnded?: () => void, likedTracks: any[] = []) {
    const onEndedRef = useRef(onEnded);
    useEffect(() => {
        onEndedRef.current = onEnded;
    }, [onEnded]);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [currentTrackPath, setCurrentTrackPath] = useState<string | null>(null);
    const [positionMs, setPositionMs] = useState(0);
    const [durationMs, setDurationMs] = useState(0);
    const [volume, setVolumeState] = useState(() => {
        const saved = localStorage.getItem('muziso_volume');
        return saved ? parseFloat(saved) : 1.0;
    });

    const setVolume = async (v: number) => {
        try {
            await invoke('set_volume', { volume: v });
            setVolumeState(v);
            localStorage.setItem('muziso_volume', v.toString());
        } catch (e) {
            console.error("Failed to set volume:", e);
        }
    };

    // Apply initial volume
    useEffect(() => {
        invoke('set_volume', { volume }).catch(() => {});
    }, []);

    const playTrack = async (path: string) => {
        try {
            await invoke('play_audio', { path });
            setCurrentTrackPath(path);
            setIsPlaying(true);
            setPositionMs(0);
            setDurationMs(0);
        } catch (e) {
            console.error("Failed to play track:", e);
        }
    };

    const streamExternalAudio = async (url: string, source: string, trackId?: string, title?: string, artist?: string) => {
        try {
            if (trackId && likedTracks) {
                const liked = likedTracks.find(t => t.id === trackId);
                if (liked && liked.local_audio_path) {
                    console.log("Offline: Playing from liked offline cache:", liked.local_audio_path);
                    await invoke('play_audio', { path: liked.local_audio_path });
                    setCurrentTrackPath(url); // Use URL as path identifier for external tracks so UI matches
                    setIsPlaying(true);
                    setPositionMs(0);
                    setDurationMs(0);
                    setIsBuffering(false);
                    return liked.local_audio_path;
                }
            }
            
            setIsBuffering(true);
            setCurrentTrackPath(url); // Immediately select track visually
            setIsPlaying(true);
            const resolvedUrl = await invoke<string>('stream_external_audio', { url, source, title: title || null, artist: artist || null });
            setIsBuffering(false);
            setPositionMs(0);
            setDurationMs(0);
            return resolvedUrl;
        } catch (e) {
            console.error("Failed to stream external audio:", e);
            setIsBuffering(false);
            return null;
        }
    };

    const togglePause = async () => {
        try {
            if (isPlaying) {
                setIsPlaying(false);
                await invoke('pause_audio');
            } else if (currentTrackPath) {
                setIsPlaying(true);
                await invoke('resume_audio');
            }
        } catch (e) {
            console.error("Failed to toggle pause:", e);
        }
    };

    const seek = async (ms: number) => {
        try {
            await invoke('seek_audio', { positionMs: ms });
            setPositionMs(ms);
        } catch (e) {
            console.error("Failed to seek audio:", e);
        }
    };

    const playNext = (tracks: TrackData[]) => {
        if (!currentTrackPath || tracks.length === 0) return;
        const idx = tracks.findIndex(t => t.filepath === currentTrackPath);
        if (idx !== -1 && idx + 1 < tracks.length) {
            playTrack(tracks[idx + 1].filepath);
        } else if (tracks.length > 0) {
            playTrack(tracks[0].filepath);
        }
    };

    const playPrev = (tracks: TrackData[]) => {
        if (!currentTrackPath || tracks.length === 0) return;
        const idx = tracks.findIndex(t => t.filepath === currentTrackPath);
        if (idx > 0) {
            playTrack(tracks[idx - 1].filepath);
        } else if (tracks.length > 0) {
            playTrack(tracks[tracks.length - 1].filepath);
        }
    };

    // Listen for backend events
    useEffect(() => {
        let unlistenBuffering: () => void;
        let unlistenReady: () => void;
        let unlistenPlaying: () => void;
        let unlistenEnded: () => void;
        let unlistenError: () => void;
        let unlistenPlayPause: () => void;
        let unlistenNext: () => void;
        let unlistenPrev: () => void;

        const setupListeners = async () => {
            unlistenBuffering = await listen<boolean>('audio-buffering', (event) => {
                setIsBuffering(event.payload);
            });
            unlistenReady = await listen<boolean>('audio-ready', (_) => {
                setIsBuffering(false);
            });
            unlistenPlaying = await listen<string>('audio-playing', (event) => {
                setIsPlaying(true);
                setIsBuffering(false);
                setCurrentTrackPath(event.payload);
                setPositionMs(0);
                setDurationMs(0);
            });
            unlistenEnded = await listen<string>('audio-ended', (_) => {
                setIsPlaying(false);
                setIsBuffering(false);
                if (onEndedRef.current) onEndedRef.current();
            });
            unlistenError = await listen<string>('audio-error', (event) => {
                setIsPlaying(false);
                setIsBuffering(false);
                // Optionally show error to user
                console.error('Audio error:', event.payload);
            });

            // Global Shortcuts
            unlistenPlayPause = await listen('shortcut-play-pause', () => {
                setIsPlaying(prev => {
                    if (prev) invoke('pause_audio');
                    else invoke('resume_audio');
                    return !prev;
                });
            });
            unlistenNext = await listen('shortcut-next', () => {
                const tr = getTracks();
                playNext(tr);
            });
            unlistenPrev = await listen('shortcut-prev', () => {
                const tr = getTracks();
                playPrev(tr);
            });
        };

        setupListeners();
        return () => {
            if (unlistenBuffering) unlistenBuffering();
            if (unlistenReady) unlistenReady();
            if (unlistenPlaying) unlistenPlaying();
            if (unlistenEnded) unlistenEnded();
            if (unlistenError) unlistenError();
            if (unlistenPlayPause) unlistenPlayPause();
            if (unlistenNext) unlistenNext();
            if (unlistenPrev) unlistenPrev();
        };
    }, []);

    // Poll position when playing
    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;

        if (isPlaying && !isBuffering) {
            interval = setInterval(async () => {
                try {
                    const pos = await invoke<number>('get_audio_position');
                    if (pos > 0 || positionMs === 0) {
                        setPositionMs(pos);
                    }

                    const dur = await invoke<number>('get_audio_duration');
                    if (dur > 0) {
                        setDurationMs(dur);
                    }
                } catch (e) { }
            }, 250);
        }
        return () => clearInterval(interval);
    }, [isPlaying, isBuffering, currentTrackPath]);

    return {
        isPlaying,
        isBuffering,
        currentTrackPath,
        positionMs,
        durationMs,
        volume,
        playTrack,
        streamExternalAudio,
        togglePause,
        seek,
        setVolume,
        playNext,
        playPrev
    };
}

export type AggregatedTrack = {
    id: string;
    title: string;
    artist: string;
    album: string;
    duration_ms: number;
    artwork_url: string;
    source: string;
    stream_url?: string;
};

export function useAggregatorSearch() {
    const [results, setResults] = useState<AggregatedTrack[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const pageRef = useRef(0);
    const lastQueryRef = useRef('');
    const lastSourceRef = useRef('youtube');
    const searchIdRef = useRef(0);

    const fetchPage = async (query: string, source: string, page: number): Promise<AggregatedTrack[]> => {
        if (source === 'all') {
            const [ytResults, scResults, spResults] = await Promise.allSettled([
                invoke<AggregatedTrack[]>('search_external', { query, source: 'youtube', page }),
                invoke<AggregatedTrack[]>('search_external', { query, source: 'soundcloud', page }),
                invoke<AggregatedTrack[]>('search_external', { query, source: 'spotify', page }),
            ]);

            const yt = ytResults.status === 'fulfilled' ? ytResults.value : [];
            const sc = scResults.status === 'fulfilled' ? scResults.value : [];
            const sp = spResults.status === 'fulfilled' ? spResults.value : [];

            // Interleave results: 2 Spotify, 2 YouTube, 1 SoundCloud, repeat
            const merged: AggregatedTrack[] = [];
            let yi = 0, si = 0, pi = 0;
            while (yi < yt.length || si < sc.length || pi < sp.length) {
                if (pi < sp.length) merged.push(sp[pi++]);
                if (pi < sp.length) merged.push(sp[pi++]);
                if (yi < yt.length) merged.push(yt[yi++]);
                if (yi < yt.length) merged.push(yt[yi++]);
                if (si < sc.length) merged.push(sc[si++]);
            }
            
            // Prioritize exact query spelling matches at the top of the search grid
            const lowerQ = query.toLowerCase().trim();
            if (lowerQ) {
                const exactMatches = merged.filter(t => t.title.toLowerCase().includes(lowerQ));
                const others = merged.filter(t => !t.title.toLowerCase().includes(lowerQ));
                return [...exactMatches, ...others];
            }
            return merged;
        } else {
            return await invoke<AggregatedTrack[]>('search_external', { query, source, page });
        }
    };

    const search = async (query: string, source: string = 'youtube') => {
        const activeSearchId = ++searchIdRef.current;

        if (!query.trim()) {
            setResults([]);
            setHasMore(true);
            setIsLoading(false);
            return;
        }

        // Immediately clear old search results and reset state to prevent stale query leaking
        setResults([]);
        pageRef.current = 0;
        lastQueryRef.current = query;
        lastSourceRef.current = source;
        setIsLoading(true);
        setError(null);
        setHasMore(true);

        try {
            const newResults = await fetchPage(query, source, 0);
            // Discard response if user initiated a newer search
            if (activeSearchId !== searchIdRef.current) return;

            setResults(newResults);
            if (newResults.length === 0) setHasMore(false);
        } catch (e) {
            if (activeSearchId !== searchIdRef.current) return;
            setError("Failed to fetch results from external sources.");
            console.error(e);
        } finally {
            if (activeSearchId === searchIdRef.current) {
                setIsLoading(false);
            }
        }
    };

    const loadMore = async () => {
        if (isLoadingMore || !hasMore || !lastQueryRef.current) return;
        const activeSearchId = searchIdRef.current;
        
        setIsLoadingMore(true);
        pageRef.current += 1;

        try {
            const newResults = await fetchPage(lastQueryRef.current, lastSourceRef.current, pageRef.current);
            if (activeSearchId !== searchIdRef.current) return;

            if (newResults.length === 0) {
                setHasMore(false);
            } else {
                // Deduplicate by ID before appending
                setResults(prev => {
                    const existingIds = new Set(prev.map(t => t.id));
                    const unique = newResults.filter(t => !existingIds.has(t.id));
                    if (unique.length === 0) setHasMore(false);
                    return [...prev, ...unique];
                });
            }
        } catch (e) {
            if (activeSearchId !== searchIdRef.current) return;
            console.error("Failed to load more results:", e);
        } finally {
            if (activeSearchId === searchIdRef.current) {
                setIsLoadingMore(false);
            }
        }
    };

    return { results, isLoading, isLoadingMore, hasMore, error, search, loadMore };
}

export type TrackData = {
    id?: string;
    filepath: string;
    title: string;
    artist: string;
    album: string;
    duration_ms: number;
    artwork_url?: string;
    source?: string;
    stream_url?: string;
    local_audio_path?: string;
    local_lyrics?: string;
};

export function useLibrary() {
    const [tracks, setTracks] = useState<TrackData[]>([]);
    const [isScanning, setIsScanning] = useState(false);

    const loadCachedTracks = async () => {
        try {
            const cached = await invoke<TrackData[]>('get_cached_tracks');
            setTracks(cached);
        } catch (e) {
            console.error("Failed to load cached tracks:", e);
        }
    };

    const scanDirectory = async (directory: string) => {
        setIsScanning(true);
        try {
            const scanned = await invoke<TrackData[]>('scan_directory', { path: directory });
            setTracks(prev => {
                // Simple merge, avoiding duplicates based on filepath
                const map = new Map(prev.map(t => [t.filepath, t]));
                scanned.forEach(t => map.set(t.filepath, t));
                return Array.from(map.values());
            });
        } catch (e) {
            console.error("Failed to scan directory:", e);
        } finally {
            setIsScanning(false);
        }
    };

    useEffect(() => {
        loadCachedTracks();
    }, []);

    return {
        tracks,
        isScanning,
        scanDirectory,
        loadCachedTracks
    };
}

export type LikedTrack = {
    id: string;
    title: string;
    artist: string;
    album: string;
    duration_ms: number;
    artwork_url: string;
    source: string;
    stream_url?: string;
    local_audio_path?: string;
    local_lyrics?: string;
};

export function useLikedLibrary() {
    const [likedTracks, setLikedTracks] = useState<LikedTrack[]>([]);
    const [isLiking, setIsLiking] = useState<Record<string, boolean>>({});

    const loadLikedTracks = async () => {
        try {
            const tracks = await invoke<LikedTrack[]>('get_liked_tracks');
            setLikedTracks(tracks);
        } catch (e) {
            console.error("Failed to load liked tracks:", e);
        }
    };

    useEffect(() => {
        loadLikedTracks();
        
        // Listen for backend downloads completing so we can refresh
        const unlisten = listen('liked-track-downloaded', () => {
            loadLikedTracks();
        });

        return () => {
            unlisten.then(f => f());
        };
    }, []);

    const toggleLike = async (track: any, currentLyrics?: string) => {
        const trackId = track.id || track.stream_url;
        if (!trackId) return;

        // Build a canonical source URL from the track ID (not the resolved stream URL which may be a temporary googlevideo.com link)
        const id = track.id || '';
        let canonicalUrl = track.stream_url;
        if (track.source === 'youtube' || id.startsWith('yt-')) {
            canonicalUrl = `https://www.youtube.com/watch?v=${id.replace('yt-', '')}`;
        } else if (track.source === 'soundcloud' || id.startsWith('sc-')) {
            canonicalUrl = `https://api-v2.soundcloud.com/tracks/${id.replace('sc-', '')}`;
        } else if (track.source === 'spotify' || id.startsWith('sp-')) {
            canonicalUrl = `https://open.spotify.com/track/${id.replace('sp-', '')}`;
        }

        setIsLiking(prev => ({ ...prev, [trackId]: true }));
        try {
            await invoke<boolean>('toggle_like', { 
                track: {
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    album: track.album || "",
                    duration_ms: track.duration_ms || 0,
                    artwork_url: track.artwork_url || "",
                    source: track.source || "external",
                    stream_url: canonicalUrl
                },
                lyrics: currentLyrics || null
            });
            await loadLikedTracks();
        } catch (e) {
            console.error("Failed to toggle like:", e);
        } finally {
            setIsLiking(prev => ({ ...prev, [trackId]: false }));
        }
    };

    return { likedTracks, isLiking, toggleLike, loadLikedTracks };
}

export function useEqualizer() {
    const [gains, setGains] = useState<number[]>(() => {
        const saved = localStorage.getItem('muziso_eq_gains');
        return saved ? JSON.parse(saved) : Array(10).fill(0);
    });

    const updateGain = (index: number, value: number) => {
        const newGains = [...gains];
        newGains[index] = value;
        setGains(newGains);
        localStorage.setItem('muziso_eq_gains', JSON.stringify(newGains));
        
        // Invoke backend
        invoke('set_eq_band', { band: index, gain: value }).catch(e => {
            console.error(`Failed to set EQ band ${index}:`, e);
        });
    };

    const resetGains = () => {
        applyPreset(Array(10).fill(0));
    };

    const applyPreset = (newGains: number[]) => {
        setGains(newGains);
        localStorage.setItem('muziso_eq_gains', JSON.stringify(newGains));
        
        newGains.forEach((gain, index) => {
            // Clamp for safety as usual
            const clamped = Math.max(-24, Math.min(12, gain));
            invoke('set_eq_band', { band: index, gain: clamped }).catch(() => {});
        });
    };

    // Apply all gains on init (if needed, or when GStreamer resets)
    useEffect(() => {
        gains.forEach((gain, index) => {
            if (gain !== 0) {
                const clamped = Math.max(-24, Math.min(12, gain));
                invoke('set_eq_band', { band: index, gain: clamped }).catch(() => {});
            }
        });
    }, []);

    return { gains, updateGain, resetGains, applyPreset };
}

export const EQ_PRESETS = {
    'Flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'Bass Boost': [7, 6, 5, 2, 0, 0, 0, 0, 0, 0],
    'Treble Boost': [0, 0, 0, 0, 0, 2, 4, 6, 7, 8],
    'Electronic': [5, 4, 2, 0, -2, 0, 2, 4, 5, 6],
    'Rock': [5, 4.5, 3, 1, -1, 0, 2, 3.5, 4.5, 5],
    'Pop': [-1.5, -1, 0, 2, 4, 4, 2, 0, -1, -1.5],
    'Vocal': [-3, -2, -1, 1, 3, 4, 4, 3, 1, -1],
    'Classical': [5, 4, 3, 2, -1, -1, 0, 2, 3, 4],
    'Jazz': [4, 3, 1, 2, -2, -2, 0, 1, 3, 4],
};

export interface ThemeColors {
    r: number;
    g: number;
    b: number;
    hex: string;
    darkRgb: string;
    headerGradient: string;
    panelBackground: string;
    accentColor: string;
}

// Muziso brand default theme — black & white
const BRAND_THEME: ThemeColors = {
    r: 220,
    g: 220,
    b: 225,
    hex: "#dcdce1",
    darkRgb: "rgb(18, 18, 18)",
    headerGradient: "linear-gradient(to bottom, rgba(220, 220, 225, 0.25) 0%, rgba(22, 22, 24, 0.97) 280px, #121212 100%)",
    panelBackground: "linear-gradient(180deg, rgba(26, 26, 28, 0.98) 0%, #121212 100%)",
    accentColor: "#dcdce1"
};

export function useDominantColor(imageUrl: string | null | undefined): ThemeColors {
    const [theme, setTheme] = useState<ThemeColors>(BRAND_THEME);

    useEffect(() => {
        // No artwork → snap back to brand default
        if (!imageUrl) {
            setTheme(BRAND_THEME);
            return;
        }

        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = imageUrl;

        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");
                if (!ctx) return;

                canvas.width = 64;
                canvas.height = 64;
                ctx.drawImage(img, 0, 0, 64, 64);

                const imageData = ctx.getImageData(0, 0, 64, 64).data;
                let rSum = 0, gSum = 0, bSum = 0, count = 0;

                for (let i = 0; i < imageData.length; i += 16) {
                    const pr = imageData[i];
                    const pg = imageData[i + 1];
                    const pb = imageData[i + 2];
                    const brightness = (pr + pg + pb) / 3;

                    // Filter out super dark backgrounds and near-white noise to get true rich vibrant album art color
                    if (brightness > 25 && brightness < 230) {
                        rSum += pr;
                        gSum += pg;
                        bSum += pb;
                        count++;
                    }
                }

                if (count > 0) {
                    let r = Math.round(rSum / count);
                    let g = Math.round(gSum / count);
                    let b = Math.round(bSum / count);

                    // Ensure minimum saturation and color presence
                    const max = Math.max(r, g, b);
                    const min = Math.min(r, g, b);
                    if (max - min < 15) {
                        // If color is greyish, boost slightly towards artist warmth
                        r = Math.min(255, r + 20);
                        g = Math.min(255, g + 20);
                        b = Math.min(255, b + 30);
                    }

                    const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
                    const darkR = Math.round(r * 0.12);
                    const darkG = Math.round(g * 0.12);
                    const darkB = Math.round(b * 0.12);

                    setTheme({
                        r,
                        g,
                        b,
                        hex,
                        darkRgb: `rgb(${darkR}, ${darkG}, ${darkB})`,
                        headerGradient: `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, 0.45) 0%, rgba(${darkR + 10}, ${darkG + 10}, ${darkB + 10}, 0.95) 280px, #121212 100%)`,
                        panelBackground: `linear-gradient(180deg, rgba(${darkR + 18}, ${darkG + 18}, ${darkB + 18}, 0.98) 0%, #121212 100%)`,
                        accentColor: hex
                    });
                }
            } catch (e) {
                console.warn("Dynamic image color extraction caught error:", e);
            }
        };
    }, [imageUrl]);

    return theme;
}

