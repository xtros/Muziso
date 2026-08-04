import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { Play, Pause, SkipForward, SkipBack, Search, Home, Library, Settings, FolderOpen, ChevronDown, ChevronLeft, ChevronRight, Maximize2, ListMusic, Heart, LayoutGrid, List, Volume2, VolumeX, Download, MonitorPlay, Sparkles, X, Music, Radio, Disc, Zap, Flame, Compass, Shuffle, Repeat, Repeat1, Crown, Check, History, Wand2, Bell, Plus, Globe, Tv, HardDrive, Shield, User, LogIn, LogOut, ShieldCheck, ArrowLeft, Trash2, Edit3, AlertTriangle, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAudioPlayer, useLibrary, fetchAlbumArt, fetchLyrics, LyricsData, useAggregatorSearch, AggregatedTrack, useLikedLibrary, useEqualizer, EQ_PRESETS, useDominantColor } from "./hooks";
// Used for interacting with system dialogs in Tauri
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { check } from "@tauri-apps/plugin-updater";
import logoImg from "./assets/logo.png";

// Hook for mouse-drag horizontal scrolling on non-touch devices
function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef({ isDown: false, startX: 0, scrollLeft: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    state.current = { isDown: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
    el.style.cursor = 'grabbing';
    el.style.userSelect = 'none';
  }, []);

  const onMouseUp = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    state.current.isDown = false;
    el.style.cursor = 'grab';
    el.style.userSelect = '';
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!state.current.isDown || !ref.current) return;
    e.preventDefault();
    const x = e.pageX - ref.current.offsetLeft;
    ref.current.scrollLeft = state.current.scrollLeft - (x - state.current.startX);
  }, []);

  const onMouseLeave = useCallback(() => {
    if (!ref.current) return;
    state.current.isDown = false;
    ref.current.style.cursor = 'grab';
    ref.current.style.userSelect = '';
  }, []);

  return { ref, onMouseDown, onMouseUp, onMouseMove, onMouseLeave };
}

// Provide a stable time formatter outside of renders
const formatTime = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const stripExtension = (title: string) => {
  return title.replace(/\.(mp3|flac|wav|m4a|ogg)$/i, '');
};

const ProgressBar = memo(({ positionMs, durationMs, onSeek }: { positionMs: number, durationMs: number | undefined, onSeek: (e: React.MouseEvent<HTMLDivElement>) => void }) => {
  const targetDuration = durationMs || 0;
  const realDuration = Math.max(targetDuration, positionMs);
  // Cap playing percentage at 99% so bar never shows completed until track actually ends
  const percentage = realDuration > 0 ? Math.min(0.99, Math.max(0, positionMs / realDuration)) : 0;
  return (
    <div className="w-full flex items-center gap-3">
      <span className="text-xs text-zinc-400 font-medium tabular-nums">
        {formatTime(positionMs)}
      </span>
      <div
        className="h-2 flex-1 bg-zinc-800/80 border border-white/10 rounded-full overflow-hidden shrink-0 group cursor-pointer relative shadow-inner"
        onClick={onSeek}
        role="slider"
        tabIndex={0}
        aria-label="Seek track"
        aria-valuemin={0}
        aria-valuemax={realDuration || 100}
        aria-valuenow={positionMs}
      >
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r w-full origin-left from-zinc-200 via-white to-zinc-300 shadow-[0_0_15px_rgba(255,255,255,0.6)] transition-transform duration-300 ease-linear"
          style={{ transform: `scaleX(${percentage})` }}
        />
      </div>
      <span className="text-xs text-zinc-400 font-medium tabular-nums">
        {realDuration > 0 ? formatTime(realDuration) : "-:--"}
      </span>
    </div>
  );
});

const ExpandedProgressBar = memo(({ positionMs, durationMs, onSeek }: { positionMs: number, durationMs: number | undefined, onSeek: (e: React.MouseEvent<HTMLDivElement>) => void }) => {
  const targetDuration = durationMs || 0;
  const realDuration = Math.max(targetDuration, positionMs);
  const percentage = realDuration > 0 ? Math.min(0.99, Math.max(0, positionMs / realDuration)) : 0;
  return (
    <div className="w-full flex items-center gap-3">
      <span className="text-xs text-white font-sans tabular-nums">{formatTime(positionMs)}</span>
      <div
        className="h-2.5 flex-1 bg-zinc-800/80 border border-white/10 rounded-full overflow-hidden shrink-0 group relative shadow-inner cursor-pointer"
        onClick={onSeek}
        role="slider"
        tabIndex={0}
        aria-label="Seek track"
        aria-valuemin={0}
        aria-valuemax={realDuration || 100}
        aria-valuenow={positionMs}
      >
        <div className="absolute inset-y-0 left-0 bg-gradient-to-r w-full origin-left from-zinc-200 via-white to-zinc-300 shadow-[0_0_20px_rgba(255,255,255,0.8)] transition-transform duration-300 ease-linear" style={{ transform: `scaleX(${percentage})` }} />
      </div>
      <span className="text-xs text-zinc-300 font-sans tabular-nums">{realDuration > 0 ? formatTime(realDuration) : "-:--"}</span>
    </div>
  );
});

const LyricsDisplay = memo(({ parsedLyrics, activeLyricIndex, hasPlainLyrics, plainLyricsText, lyricsOffsetMs, onOffsetChange, onUploadLyrics }: { parsedLyrics: { timeMs: number, text: string }[], activeLyricIndex: number, hasPlainLyrics: boolean, plainLyricsText?: string, lyricsOffsetMs: number, onOffsetChange: (offset: number) => void, onUploadLyrics?: () => void }) => {

  // Smoothly scroll the active lyric into the center of the mask
  useEffect(() => {
    if (activeLyricIndex >= 0 && parsedLyrics.length > 0) {
      const activeLine = document.getElementById(`lyric-${activeLyricIndex}`);
      if (activeLine) {
        activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeLyricIndex, parsedLyrics.length]);

  return (
    <div
      className="lyrics-container no-scrollbar py-[40vh] px-4 md:px-12 overflow-y-auto scroll-smooth group/lyrics"
      id="lyrics-scroll-root"
      style={{
        maskImage: "linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)"
      }}
    >
      {/* Control Bar */}
      <div className="fixed top-8 right-8 z-50 flex items-center gap-2 transition-opacity group-hover/lyrics:opacity-100 opacity-20 hover:opacity-100">
        {onUploadLyrics && (
          <button
            onClick={onUploadLyrics}
            className="flex items-center gap-2 bg-black/40 backdrop-blur-xl rounded-full px-4 py-2 border border-white/10 shadow-2xl text-xs font-bold text-white hover:text-[var(--color-neon-yellow)] hover:bg-white/10 transition-all"
            title="Upload Lyrics (.lrc, .srt, .vtt)"
          >
            <ListMusic size={14} />
            <span>Upload</span>
          </button>
        )}
        {parsedLyrics.length > 0 && (
          <div className="flex items-center gap-4 bg-black/40 backdrop-blur-xl rounded-full px-4 py-2 border border-white/10 shadow-2xl">
            <button onClick={() => onOffsetChange(lyricsOffsetMs - 500)} className="text-white hover:text-[var(--color-neon-yellow)] font-bold w-6 h-6 flex items-center justify-center bg-white/10 rounded-full" title="Advance lyrics (-0.5s)">-</button>
            <span className="text-xs font-mono text-white font-bold w-12 text-center" title="Current Lyrics Offset">{lyricsOffsetMs > 0 ? '+' : ''}{(lyricsOffsetMs / 1000).toFixed(1)}s</span>
            <button onClick={() => onOffsetChange(lyricsOffsetMs + 500)} className="text-white hover:text-[var(--color-neon-yellow)] font-bold w-6 h-6 flex items-center justify-center bg-white/10 rounded-full" title="Delay lyrics (+0.5s)">+</button>
          </div>
        )}
      </div>

      {parsedLyrics.length > 0 ? (
        <div className="flex flex-col gap-6 md:gap-10">
          {parsedLyrics.map((line, ix) => {
            const isActive = ix === activeLyricIndex;

            return (
              <div
                key={ix}
                id={`lyric-${ix}`}
                className={`px-2 py-1 transition-all duration-500 ease-out origin-left will-change-[transform,opacity]
                  ${isActive ? 'scale-105 opacity-100' : 'scale-100 opacity-20'}`}
              >
                <p className={`text-2xl md:text-5xl font-lyrics font-black tracking-tight leading-tight transition-colors duration-500
                  ${isActive ? 'liquid-neon-text' : 'text-white'}`}>
                  {line.text}
                </p>
              </div>
            );
          })}
        </div>
      ) : hasPlainLyrics && plainLyricsText ? (
        <div className="flex flex-col gap-4 py-8">
          <p className="text-sm font-bold text-[var(--color-neon-yellow)] tracking-widest uppercase mb-4 opacity-80">Unsynchronized Lyrics</p>
          {plainLyricsText.split('\n').map((line, ix) => (
            <div key={ix} className="px-2 py-1">
              <p className={`text-2xl md:text-4xl font-lyrics font-bold tracking-tight leading-tight text-white/80`}>
                {line || "\u00A0"}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="h-full flex flex-col items-center justify-center px-6 relative">
          <div className="relative z-10 flex flex-col items-center gap-5 p-8 bg-black/20 border border-white/5 rounded-3xl backdrop-blur-xl shadow-2xl transition-all hover:bg-black/30">
            <div className="relative p-4 bg-white/5 rounded-2xl border border-white/10">
              <Music size={42} className="text-white/40" />
              <Sparkles size={20} className="absolute -top-1.5 -right-1.5 text-[var(--color-neon-yellow)] animate-pulse opacity-80" />
            </div>
            
            <div className="flex flex-col gap-2 text-center">
              <h3 className="text-lg md:text-xl font-display font-bold text-white/90 tracking-wide">
                Lyrics Unavailable
              </h3>
              <p className="text-sm text-white/50 max-w-[240px] leading-relaxed">
                There are no lyrics for this song at the moment. Sit back and enjoy the music!
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

const ViewToggle = memo(({ viewMode, onChange }: { viewMode: 'grid' | 'list', onChange: (mode: 'grid' | 'list') => void }) => {
  return (
    <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
      <button
        onClick={() => onChange('grid')}
        className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-[var(--color-neon-yellow)] text-black' : 'text-neutral-400 hover:text-white hover:bg-white/5'}`}
        title="Grid View"
      >
        <LayoutGrid size={18} />
      </button>
      <button
        onClick={() => onChange('list')}
        className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-[var(--color-neon-yellow)] text-black' : 'text-neutral-400 hover:text-white hover:bg-white/5'}`}
        title="List View"
      >
        <List size={18} />
      </button>
    </div>
  );
});

interface NewsTrack {
  title: string;
  artist: string;
  artwork_url: string;
  url: string;
  release_date: string;
}

interface NewsPlaylist {
  id: string;
  title: string;
  subtitle: string;
  artwork_url: string;
  type: string; // 'playlist' or 'album'
}

interface NewsResponse {
  songs: NewsTrack[];
  playlists: NewsPlaylist[];
}

interface UserProfile {
  name: string;
  email?: string;
  avatarUrl?: string;
  avatarGradient?: string;
  isLoggedIn: boolean;
}

const AVATAR_GRADIENTS = [
  { label: "Purple Emerald", class: "from-purple-600 to-emerald-500" },
  { label: "Sunset Amber", class: "from-amber-500 to-rose-600" },
  { label: "Neon Cyan", class: "from-cyan-500 to-blue-600" },
  { label: "Electric Lime", class: "from-lime-400 to-emerald-600" },
  { label: "Fuchsia Violet", class: "from-fuchsia-600 to-pink-500" },
  { label: "Dark Sapphire", class: "from-zinc-700 to-zinc-900" }
];

function getInitials(name: string): string {
  if (!name || !name.trim()) return 'J';
  return name.trim().charAt(0).toUpperCase();
}

const EqSlider = memo(({ index, gain, label, sub, onChange }: { index: number, gain: number, label: string, sub: string, onChange: (index: number, val: number) => void }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const calcGainFromPointer = (clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = 1 - (clientY - rect.top) / rect.height;
    const clampedRatio = Math.min(1, Math.max(0, ratio));
    const value = -24 + clampedRatio * 36;
    const rounded = Math.round(value * 2) / 2;
    onChange(index, rounded);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    calcGainFromPointer(e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    calcGainFromPointer(e.clientY);
  };

  const handlePointerUp = () => {
    isDragging.current = false;
  };

  return (
    <div className="flex flex-col items-center gap-5 flex-none md:flex-1 min-w-[70px] md:min-w-0 snap-center">
      <div 
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative h-44 w-8 md:w-6 flex items-center justify-center cursor-pointer select-none rounded-full"
      >
        <div className="relative h-full w-2 bg-white/10 border border-white/10 rounded-full overflow-hidden pointer-events-none">
          <div
            className="absolute inset-x-0 bottom-0 bg-white rounded-full transition-all"
            style={{ height: `${((gain + 24) / 36) * 100}%` }}
          />
        </div>
      </div>
      <div className="text-center select-none">
        <p className="text-[10px] font-black text-white tracking-widest">{label}</p>
        <p className="text-[8px] text-neutral-400 uppercase font-bold truncate max-w-[45px]">{sub}</p>
        <p className={`text-[10px] font-bold mt-1 transition-colors duration-150 ${gain === 0 ? 'text-neutral-400' : 'text-white'}`}>
          {gain > 0 ? `+${gain}` : gain}
        </p>
      </div>
    </div>
  );
});

const Equalizer = memo(() => {
  const { gains, updateGain, applyPreset } = useEqualizer();
  const presetScroll = useDragScroll();
  const sliderScroll = useDragScroll();
  const bands = [
    { label: '31Hz', sub: 'Bass' },
    { label: '62Hz', sub: 'Bass' },
    { label: '125Hz', sub: 'Low Mid' },
    { label: '250Hz', sub: 'Mid' },
    { label: '500Hz', sub: 'Mid' },
    { label: '1kHz', sub: 'Mid' },
    { label: '2kHz', sub: 'High Mid' },
    { label: '4kHz', sub: 'Treble' },
    { label: '8kHz', sub: 'Treble' },
    { label: '16kHz', sub: 'Air' }
  ];

  return (
    <div className="glass-panel p-6 md:p-8 rounded-3xl border border-white/5 space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-3 flex-none">
          <Volume2 size={24} className="text-white" />
          10-Band EQ
        </h3>

        <div
          ref={presetScroll.ref}
          onMouseDown={presetScroll.onMouseDown}
          onMouseUp={presetScroll.onMouseUp}
          onMouseMove={presetScroll.onMouseMove}
          onMouseLeave={presetScroll.onMouseLeave}
          className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 -mx-2 px-2 scroll-smooth touch-pan-x"
          style={{ cursor: 'grab' }}
        >
          {Object.entries(EQ_PRESETS).map(([name, presetGains]) => {
            const isActive = JSON.stringify(gains) === JSON.stringify(presetGains);
            return (
              <button
                key={name}
                onClick={() => applyPreset(presetGains)}
                className={`flex-none px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border whitespace-nowrap active:scale-95 ${isActive
                  ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.4)]'
                  : 'bg-white/10 text-neutral-300 border-white/10 hover:bg-white/20 hover:border-white/30 hover:text-white'
                  }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={sliderScroll.ref}
        onMouseDown={sliderScroll.onMouseDown}
        onMouseUp={sliderScroll.onMouseUp}
        onMouseMove={sliderScroll.onMouseMove}
        onMouseLeave={sliderScroll.onMouseLeave}
        className="flex items-end h-72 gap-4 md:gap-5 overflow-x-auto no-scrollbar pb-6 md:justify-between snap-x relative touch-pan-x"
        style={{ cursor: 'grab' }}
      >
        {bands.map((band, i) => (
          <EqSlider
            key={band.label}
            index={i}
            gain={gains[i]}
            label={band.label}
            sub={band.sub}
            onChange={updateGain}
          />
        ))}
      </div>
    </div>
  );
});

const VolumeControl = memo(({ volume, onChange }: { volume: number, onChange: (v: number) => void }) => {
  const [isHovered, setIsHovered] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const calcVolumeFromPointer = useCallback((clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = 1 - (clientY - rect.top) / rect.height;
    onChange(Math.min(1, Math.max(0, ratio)));
  }, [onChange]);

  const calcVolumeRef = useRef(calcVolumeFromPointer);
  useEffect(() => {
    calcVolumeRef.current = calcVolumeFromPointer;
  }, [calcVolumeFromPointer]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const onDown = (e: PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      isDragging.current = true;
      track.setPointerCapture(e.pointerId);
      calcVolumeRef.current(e.clientY);
    };

    const onMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      calcVolumeRef.current(e.clientY);
    };

    const onUp = () => {
      isDragging.current = false;
    };

    track.addEventListener('pointerdown', onDown);
    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onUp);
    track.addEventListener('pointercancel', onUp);

    return () => {
      track.removeEventListener('pointerdown', onDown);
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onUp);
    };
  }, [isHovered]); // Rebind when popup is shown/hidden to bind to the newly rendered track

  return (
    <div
      className="relative flex items-center justify-center"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.9 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute bottom-12 flex flex-col items-center justify-center w-12 h-40 bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-50 py-4"
          >
            {/* Draggable track area */}
            <div
              ref={trackRef}
              className="relative w-8 h-32 flex items-center justify-center cursor-pointer select-none"
            >
              {/* Visual track */}
              <div className="relative w-2 h-full bg-zinc-800 border border-white/10 rounded-full overflow-hidden pointer-events-none">
                {/* Fill */}
                <div
                  className="absolute bottom-0 w-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)] rounded-full transition-[height] duration-75"
                  style={{ height: `${volume * 100}%` }}
                />
              </div>
              {/* Thumb dot */}
              <div
                className="absolute left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-lg border border-zinc-300 pointer-events-none transition-[bottom] duration-75"
                style={{ bottom: `calc(${volume * 100}% - 7px)` }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        className="text-neutral-400 hover:text-white transition-all p-2 hover:bg-white/5 rounded-full"
        onClick={() => onChange(volume === 0 ? 0.5 : 0)}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
      </button>
    </div>
  );
});

// ─── Song Right-Click Context Menu ───────────────────────────────────────────
type ContextMenuTrack = {
  id?: string;
  title: string;
  artist?: string;
  artwork_url?: string;
  source?: string;
  filepath?: string;
  stream_url?: string;
  [key: string]: any;
};

type ContextMenuState = {
  x: number;
  y: number;
  track: ContextMenuTrack;
  playlistId?: string;
} | null;


type SongContextMenuProps = {
  menu: ContextMenuState;
  onClose: () => void;
  onPlay: (track: ContextMenuTrack) => void;
  onAddToQueue: (track: ContextMenuTrack) => void;
  onLike: (track: ContextMenuTrack) => void;
  isLiked: boolean;
  onCopyTitle: (track: ContextMenuTrack) => void;
  onSearchArtist: (track: ContextMenuTrack) => void;
  onAddToPlaylist: (track: ContextMenuTrack) => void;
  onRemoveFromPlaylist?: (playlistId: string, track: ContextMenuTrack) => void;
};

const SongContextMenu = memo(({
  menu, onClose, onPlay, onAddToQueue, onLike, isLiked, onCopyTitle, onSearchArtist, onAddToPlaylist, onRemoveFromPlaylist
}: SongContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!menu) return;
    // Adjust position so menu never clips off screen
    const menuW = 220, menuH = 300;
    const x = Math.min(menu.x, window.innerWidth - menuW - 8);
    const y = Math.min(menu.y, window.innerHeight - menuH - 8);
    setAdjustedPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [menu, onClose]);

  if (!menu) return null;

  const track = menu.track;

  const items: Array<{ icon: React.ReactNode; label: string; action: () => void; danger?: boolean; divider?: boolean }> = [
    {
      icon: <Play size={15} fill="currentColor" />,
      label: 'Play Now',
      action: () => { onPlay(track); onClose(); }
    },
    {
      icon: <ListMusic size={15} />,
      label: 'Add to Queue',
      action: () => { onAddToQueue(track); onClose(); },
      divider: true,
    },
    {
      icon: isLiked ? <Heart size={15} fill="currentColor" className="text-red-400" /> : <Heart size={15} />,
      label: isLiked ? 'Remove from Liked' : 'Add to Liked Songs',
      action: () => { onLike(track); onClose(); }
    },
    {
      icon: <Plus size={15} />,
      label: 'Add to Playlist',
      action: () => { onAddToPlaylist(track); onClose(); },
      divider: true,
    },
    ...(menu.playlistId && onRemoveFromPlaylist ? [{
      icon: <Trash2 size={15} className="text-red-400" />,
      label: 'Remove from Playlist',
      action: () => { onRemoveFromPlaylist(menu.playlistId!, track); onClose(); },
      danger: true,
      divider: true,
    }] : []),
    {
      icon: <Search size={15} />,
      label: `Find "${(track.artist || 'Artist').split(',')[0].trim()}"`,
      action: () => { onSearchArtist(track); onClose(); }
    },
    {
      icon: <Globe size={15} />,
      label: 'Copy Song Title',
      action: () => { onCopyTitle(track); onClose(); }
    },
  ];

  return (
    <AnimatePresence>
      {menu && (
        <>
          {/* Invisible backdrop to catch outside clicks */}
          <div className="fixed inset-0 z-[998]" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />

          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, scale: 0.92, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -8 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            className="fixed z-[999] w-56 rounded-2xl overflow-hidden shadow-2xl"
            style={{
              left: adjustedPos.x,
              top: adjustedPos.y,
              background: 'rgba(18, 18, 20, 0.92)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid var(--theme-border, rgba(255,255,255,0.12))',
              boxShadow: `0 24px 48px rgba(0,0,0,0.6), 0 0 0 1px var(--theme-border, rgba(255,255,255,0.08)), 0 0 40px var(--theme-glow, rgba(255,255,255,0.05))`
            }}
          >
            {/* Track info header */}
            <div className="px-3 py-2.5 flex items-center gap-2.5 border-b border-white/8">
              <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-zinc-800">
                {track.artwork_url
                  ? <img src={track.artwork_url} className="w-full h-full object-cover" alt="" />
                  : <div className="w-full h-full bg-zinc-700 flex items-center justify-center"><Music size={14} className="text-zinc-500" /></div>
                }
              </div>
              <div className="min-w-0">
                <p className="text-white text-xs font-bold truncate leading-tight">{track.title}</p>
                <p className="text-neutral-500 text-[10px] truncate leading-tight mt-0.5">{track.artist || '—'}</p>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-1.5">
              {items.map((item, i) => (
                <div key={i}>
                  {item.divider && i > 0 && <div className="my-1 mx-3 border-t border-white/6" />}
                  <button
                    onClick={item.action}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium transition-all duration-100 text-left
                      ${item.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-neutral-200 hover:text-white'}
                      hover:bg-white/6 active:bg-white/10`}
                    style={{'--tw-bg-opacity': '1'} as any}
                  >
                    <span className="text-neutral-400 shrink-0 group-hover:text-white"
                      style={{ color: item.label === 'Play Now' ? 'var(--theme-accent, white)' : undefined }}>
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
});

const PromptDialog = ({
  title,
  defaultValue,
  onConfirm,
  onCancel
}: {
  title: string;
  defaultValue: string;
  onConfirm: (val: string | null) => void;
  onCancel: () => void;
}) => {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onConfirm(value);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-zinc-950/90 border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl flex flex-col gap-5 backdrop-blur-2xl"
      >
        <div className="flex flex-col gap-2">
          <span className="text-xs font-black text-[#ccff00] uppercase tracking-widest">Prompt</span>
          <h3 className="text-lg font-display font-extrabold text-white leading-snug">
            {title}
          </h3>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full bg-zinc-900/90 focus:bg-black text-white text-sm font-medium rounded-2xl py-3 px-4 placeholder-zinc-500 border border-white/10 focus:border-[#ccff00] focus:ring-2 focus:ring-[#ccff00]/20 focus:outline-none transition-all shadow-inner"
        />

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white font-bold text-xs transition-all active:scale-95 border border-white/5"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(value)}
            className="px-5 py-2.5 rounded-2xl bg-[#ccff00] hover:bg-[#b5e600] text-black font-extrabold text-xs transition-all shadow-md active:scale-95"
          >
            OK
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const ConfirmDialog = ({
  title,
  message,
  onConfirm,
  onCancel
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setTimeout(() => {
      if (confirmButtonRef.current) {
        confirmButtonRef.current.focus();
      }
    }, 50);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
      onKeyDown={handleKeyDown}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-zinc-950/90 border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl flex flex-col gap-5 backdrop-blur-2xl"
      >
        <div className="flex gap-4 items-start">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-xs font-black text-amber-500 uppercase tracking-widest">{title}</span>
            <h3 className="text-base font-display font-extrabold text-white leading-snug break-words">
              {message}
            </h3>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white font-bold text-xs transition-all active:scale-95 border border-white/5"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-2xl bg-[#ccff00] hover:bg-[#b5e600] text-black font-extrabold text-xs transition-all shadow-md active:scale-95"
          >
            OK
          </button>
        </div>
      </motion.div>
    </div>
  );
};

function App() {
  const [externalTrack, setExternalTrack] = useState<any | null>(null);
  const [isMiniplayerMode, setIsMiniplayerMode] = useState(false);
  const previousWindowSize = useRef<{ width: number, height: number, x: number, y: number } | null>(null);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const mainScrollRef = useRef<HTMLElement>(null);

  const toggleMiniplayerMode = async () => {
    try {
      const appWindow = getCurrentWindow();
      if (!isMiniplayerMode) {
        // Switching TO miniplayer
        const size = await appWindow.outerSize();
        const position = await appWindow.outerPosition();
        const factor = await appWindow.scaleFactor();

        const logicalSize = size.toLogical(factor);
        const logicalPos = position.toLogical(factor);

        previousWindowSize.current = {
          width: logicalSize.width,
          height: logicalSize.height,
          x: logicalPos.x,
          y: logicalPos.y
        };

        // Order matters for some window managers
        await appWindow.setDecorations(false);
        await appWindow.setAlwaysOnTop(true);
        await appWindow.setSize(new LogicalSize(400, 150));
        setIsMiniplayerMode(true);
      } else {
        // Switching FROM miniplayer
        await appWindow.setDecorations(true);
        await appWindow.setAlwaysOnTop(false);
        if (previousWindowSize.current) {
          await appWindow.setSize(new LogicalSize(previousWindowSize.current.width, previousWindowSize.current.height));
          await appWindow.setPosition(new LogicalPosition(previousWindowSize.current.x, previousWindowSize.current.y));
        } else {
          // Fallback to a sane default size if no previous state
          await appWindow.setSize(new LogicalSize(1200, 800));
        }
        setIsMiniplayerMode(false);
      }
    } catch (e) {
      console.error("Failed to toggle miniplayer:", e);
      // Ensure we at least flip the state so the UI isn't stuck
      setIsMiniplayerMode(!isMiniplayerMode);
    }
  };

  // References for global media keys
  const onTogglePlayRef = useRef<any>(null);
  const onNextRef = useRef<any>(null);
  const onPrevRef = useRef<any>(null);

  const [showLyricsOverlay, setShowLyricsOverlay] = useState(false);
  const [videoMode, setVideoMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('nekobeat_video_mode');
    return saved ? JSON.parse(saved) : false;
  });

  const { tracks, isScanning, scanDirectory } = useLibrary();
  const { results: searchResults, isLoading: isSearching, isLoadingMore, hasMore, search: performSearch, loadMore } = useAggregatorSearch();
  const { likedTracks, isLiking, toggleLike } = useLikedLibrary();

  const handleNextTrackRef = useRef<(() => void) | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll: auto-load more when sentinel becomes visible
  useEffect(() => {
    const el = loadMoreSentinelRef.current;
    if (!el || !hasMore || isLoadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { rootMargin: '600px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [searchResults.length, hasMore, isLoadingMore]);

  // Audio player state and actions
  const {
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
  } = useAudioPlayer(() => tracks, () => {
    if (handleNextTrackRef.current) handleNextTrackRef.current();
  }, likedTracks);

  const [coverArt, setCoverArt] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showQueueDrawer, setShowQueueDrawer] = useState(false);
  const [autoplayRecommendations, setAutoplayRecommendations] = useState<any[]>([]);
  const [isFetchingAutoplay, setIsFetchingAutoplay] = useState<boolean>(false);
  const [lyricsOffsetMs, setLyricsOffsetMs] = useState(0);
  const [lyricsData, setLyricsData] = useState<LyricsData | null>(null);
  const [parsedLyrics, setParsedLyrics] = useState<{ timeMs: number, text: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [customPrompt, setCustomPrompt] = useState<{
    isOpen: boolean;
    title: string;
    defaultValue: string;
    resolve: ((val: string | null) => void) | null;
  }>({
    isOpen: false,
    title: "",
    defaultValue: "",
    resolve: null
  });

  const showPrompt = (title: string, defaultValue: string = ""): Promise<string | null> => {
    return new Promise((resolve) => {
      setCustomPrompt({
        isOpen: true,
        title,
        defaultValue,
        resolve
      });
    });
  };

  const [customConfirm, setCustomConfirm] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    resolve: ((val: boolean) => void) | null;
  }>({
    isOpen: false,
    title: "",
    message: "",
    resolve: null
  });

  const showConfirm = (message: string, title: string = "Muziso"): Promise<boolean> => {
    return new Promise((resolve) => {
      setCustomConfirm({
        isOpen: true,
        title,
        message,
        resolve
      });
    });
  };

  const [notifications, setNotifications] = useState<any[]>([]);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const [showNotificationsMenu, setShowNotificationsMenu] = useState(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  useEffect(() => {
    const checkForAppUpdate = async () => {
      try {
        console.log("Checking for app update via Tauri plugin-updater...");
        const update = await check();
        console.log("Tauri update check result:", update);
        if (update && update.available) {
          setUpdateInfo(update);
          return;
        }
      } catch (err) {
        console.warn("Tauri updater check skipped or failed:", err);
      }

      // Direct fallback check against latest.json Gist (ensures dev testing always triggers)
      try {
        const gistRes = await fetch(
          "https://gist.githubusercontent.com/xtros/53b5965cc67d39cd7f721c714ade0309/raw/latest.json",
          { cache: "no-store" }
        );
        if (gistRes.ok) {
          const latestData = await gistRes.json();
          if (latestData && latestData.version && latestData.version !== "0.1.0") {
            setUpdateInfo({
              version: latestData.version,
              body: latestData.notes || `Muziso v${latestData.version} is available!`,
              date: latestData.pub_date,
            });
          }
        }
      } catch (e) {
        console.debug("Direct latest.json fetch skipped:", e);
      }
    };

    checkForAppUpdate();
  }, []);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('muziso_read_notifications');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const markAllNotificationsAsRead = () => {
    const allIds = notifications.map(n => String(n.id));
    setReadNotificationIds(allIds);
    try {
      localStorage.setItem('muziso_read_notifications', JSON.stringify(allIds));
    } catch (e) {
      console.error(e);
    }
    setHasUnreadNotifications(false);
  };

  useEffect(() => {
    const fetchDeveloperMessages = async () => {
      try {
        const endpointUrl =
          localStorage.getItem("muziso_announcement_url") ||
          "https://gist.githubusercontent.com/xtros/b437f16425c085742977035f29a5ed00/raw/announcement.json";

        const res = await fetch(endpointUrl, { cache: "no-store" });
        if (res.ok) {
          const rawData = await res.json();
          let items: any[] = [];

          if (Array.isArray(rawData)) {
            items = rawData;
          } else if (rawData && typeof rawData === "object") {
            if (rawData.active !== false) {
              items = [rawData];
            }
          }

          const normalized = items.map((item, index) => ({
            id: item.id || `msg-${index}`,
            title: item.title || "Developer Announcement",
            content: item.content || item.message || "",
            date: item.date || item.publishedAt || new Date().toISOString().split("T")[0],
            type: item.type || "info",
            actionLabel: item.actionLabel || item.linkText || (item.link ? "View Details" : undefined),
            actionUrl: item.actionUrl || item.link || undefined,
          }));

          setNotifications(normalized);
          const saved = localStorage.getItem("muziso_read_notifications");
          const readIds = saved ? JSON.parse(saved) : [];
          const unread = normalized.some((n) => !readIds.includes(String(n.id)));
          setHasUnreadNotifications(unread);
        }
      } catch (err) {
        console.error("Failed to fetch developer messages:", err);
        const mockMessages = [
          {
            id: "1",
            title: "Welcome to Muziso! 🎧",
            content:
              "Thank you for trying Muziso, your ultimate aggregator music player. Stream seamlessly across YouTube, SoundCloud, and Spotify!",
            date: "2026-08-04",
            type: "update",
            actionLabel: "View Release Notes",
            actionUrl: "https://github.com/xtros/Muziso",
          },
        ];
        setNotifications(mockMessages);
        try {
          const saved = localStorage.getItem("muziso_read_notifications");
          const readIds = saved ? JSON.parse(saved) : [];
          const unread = mockMessages.some((n) => !readIds.includes(String(n.id)));
          setHasUnreadNotifications(unread);
        } catch (e) {
          setHasUnreadNotifications(true);
        }
      }
    };

    fetchDeveloperMessages();
    const interval = setInterval(fetchDeveloperMessages, 60 * 1000); // Check every 60 seconds (1 minute)
    return () => clearInterval(interval);
  }, []);
  const [searchSource, setSearchSource] = useState<'all' | 'youtube' | 'soundcloud' | 'spotify' | 'bandcamp' | 'vk' | 'yandex'>('all');
  const [activeSources, setActiveSources] = useState({
    youtube: true,
    soundcloud: true,
    spotify: true
  });
  const [activeTab, setActiveTab] = useState<'listen' | 'browse' | 'library' | 'settings' | 'liked' | 'premium' | 'account' | 'playlists_list' | 'playlist' | 'external_playlist'>('listen');
  const [playlists, setPlaylists] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('muziso_playlists');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [selectedExternalPlaylist, setSelectedExternalPlaylist] = useState<NewsPlaylist | null>(null);
  const [externalPlaylistTracks, setExternalPlaylistTracks] = useState<any[]>([]);
  const [externalPlaylistLoading, setExternalPlaylistLoading] = useState<boolean>(false);
  const [prevTab, setPrevTab] = useState<'listen' | 'browse'>('listen');

  const handleOpenExternalPlaylist = async (playlist: NewsPlaylist) => {
    if (activeTab === 'listen' || activeTab === 'browse') {
      setPrevTab(activeTab);
    }
    setSelectedExternalPlaylist(playlist);
    setExternalPlaylistTracks([]);
    setExternalPlaylistLoading(true);
    setActiveTab('external_playlist');
    
    try {
      const tracks = await invoke<NewsTrack[]>('fetch_jiosaavn_playlist', { id: playlist.id, isAlbum: playlist.type === 'album' });
      if (tracks && tracks.length > 0) {
        const converted = tracks.map(t => ({
          id: `saavn-${t.title}-${t.artist}`,
          title: t.title,
          artist: t.artist,
          artwork_url: t.artwork_url,
          source: 'spotify' as const
        }));
        setExternalPlaylistTracks(converted);
      }
    } catch (e) {
      console.error("Failed to fetch JioSaavn playlist", e);
    } finally {
      setExternalPlaylistLoading(false);
    }
  };

  const handleOpenDailyMix = (mix: { id: string; title: string; subtitle: string; artwork_url: string; tracks: any[] }) => {
    if (activeTab === 'listen' || activeTab === 'browse') {
      setPrevTab(activeTab);
    }
    setSelectedExternalPlaylist({
      id: mix.id,
      title: mix.title,
      subtitle: mix.subtitle,
      artwork_url: mix.artwork_url,
      type: 'playlist'
    });
    setExternalPlaylistTracks(mix.tracks);
    setExternalPlaylistLoading(false);
    setActiveTab('external_playlist');
  };

  const [showAddToPlaylistModal, setShowAddToPlaylistModal] = useState<any | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [trendingNews, setTrendingNews] = useState<NewsTrack[]>([]);
  const [trendingPlaylists, setTrendingPlaylists] = useState<NewsPlaylist[]>([]);
  const [trendingNewsLoading, setTrendingNewsLoading] = useState(true);

  const [showPrankModal, setShowPrankModal] = useState(false);
  const [prankToast, setPrankToast] = useState<string | null>(null);
  const [autoLoopLiked, setAutoLoopLiked] = useState<boolean>(() => {
    const saved = localStorage.getItem('muziso_auto_loop_liked');
    return saved ? JSON.parse(saved) : false;
  });
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    const saved = localStorage.getItem('muziso_view_mode');
    return (saved as 'grid' | 'list') || 'grid';
  });
  // User Profile & Account state
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem('muziso_user_profile');
      return saved ? JSON.parse(saved) : { name: 'Guest Listener', email: '', avatarGradient: 'from-zinc-700 to-zinc-900', isLoggedIn: true };
    } catch {
      return { name: 'Guest Listener', email: '', avatarGradient: 'from-zinc-700 to-zinc-900', isLoggedIn: true };
    }
  });

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [editName, setEditName] = useState(userProfile.name);
  const [editEmail, setEditEmail] = useState(userProfile.email || '');
  const [editAvatarUrl, setEditAvatarUrl] = useState(userProfile.avatarUrl || '');
  const [editGradient, setEditGradient] = useState(userProfile.avatarGradient || 'from-purple-600 to-emerald-500');

  const saveProfile = (newProfile: UserProfile) => {
    setUserProfile(newProfile);
    try {
      localStorage.setItem('muziso_user_profile', JSON.stringify(newProfile));
    } catch { }
    setShowProfileModal(false);
  };

  const [_isSearchFocused, setIsSearchFocused] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version: string, date?: string, body?: string, releaseUrl?: string } | null>(null);
  const [streamError, setStreamError] = useState<{ message: string, trackTitle?: string, trackArtist?: string, source?: string, previewUrl?: string } | null>(null);

  // Repeat & Shuffle state
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>(() => {
    const saved = localStorage.getItem('muziso_repeat_mode');
    return (saved as 'off' | 'all' | 'one') || 'off';
  });
  const [isShuffle, setIsShuffle] = useState<boolean>(() => {
    const saved = localStorage.getItem('muziso_shuffle');
    return saved ? JSON.parse(saved) : false;
  });
  const [shuffledNextTrack, setShuffledNextTrack] = useState<any | null>(null);
  const [originalPlaylistContext, setOriginalPlaylistContext] = useState<string | null>(null);
  const [originalPlaylistTracks, setOriginalPlaylistTracks] = useState<any[]>([]);

  useEffect(() => {
    localStorage.setItem('muziso_repeat_mode', repeatMode);
  }, [repeatMode]);

  useEffect(() => {
    localStorage.setItem('muziso_shuffle', JSON.stringify(isShuffle));
  }, [isShuffle]);



  const toggleRepeat = useCallback(() => {
    setRepeatMode(prev => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
  }, []);




  useEffect(() => {
    localStorage.setItem('muziso_auto_loop_liked', JSON.stringify(autoLoopLiked));
  }, [autoLoopLiked]);

  useEffect(() => {
    localStorage.setItem('muziso_view_mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('muziso_video_mode', JSON.stringify(videoMode));
  }, [videoMode]);

  // Extract YouTube video ID from the current track (if applicable)
  const getYouTubeVideoId = (track: any): string | null => {
    if (!track) return null;
    if (track.source === 'youtube' && track.id) {
      return track.id.replace('yt-', '');
    }
    return null;
  };

  const currentTrack = tracks.find(t => t.filepath === currentTrackPath);

  // Helper to get track info for player
  let playerTrack = currentTrack;
  if (!playerTrack && externalTrack && currentTrackPath) {
    // If we're not playing a library track, and we have an external track in state, 
    // it must be the one we're currently streaming. This is more resilient than path string matching.
    playerTrack = externalTrack;
  }

  const toggleShuffle = useCallback(() => {
    setIsShuffle(prev => {
      const nextShuffle = !prev;
      
      if (nextShuffle) {
        // Shuffling the remaining queue
        setQueue(currentQueue => {
          const shuffled = [...currentQueue];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          return shuffled;
        });
      } else {
        // Unshuffling the remaining queue using original playlist order
        if (originalPlaylistTracks.length > 0 && playerTrack) {
          const currentIdx = originalPlaylistTracks.findIndex((t: any) => t.id === playerTrack?.id || (t.filepath && t.filepath === playerTrack?.filepath));
          if (currentIdx !== -1) {
            const upcoming = originalPlaylistTracks.slice(currentIdx + 1).map((t: any) => ({
              ...t,
              playbackContext: 'queue'
            }));
            setQueue(upcoming);
          }
        }
      }
      
      return nextShuffle;
    });
  }, [originalPlaylistTracks, playerTrack]);

  const [recentlyPlayed, setRecentlyPlayed] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('muziso_recently_played');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (!isShuffle) {
      setShuffledNextTrack(null);
      return;
    }

    // Determine current playlist
    if (externalTrack) {
      const isLikedContext = externalTrack.playbackContext === 'liked';
      const isRecentContext = externalTrack.playbackContext === 'recent';
      const isPlaylistContext = externalTrack.playbackContext?.startsWith('playlist-');
      const isExternalPlaylistContext = externalTrack.playbackContext === 'external-playlist';
      
      let playlist = isLikedContext 
        ? likedTracks 
        : (isRecentContext 
            ? recentlyPlayed 
            : (isExternalPlaylistContext 
                ? externalPlaylistTracks 
                : searchResults));
      if (isPlaylistContext) {
        const plId = externalTrack.playbackContext.replace('playlist-', '');
        const pl = playlists.find(p => p.id === plId);
        playlist = pl ? pl.tracks : [];
      }

      if (playlist.length > 1) {
        const currentIdx = playlist.findIndex((t: any) => t.id === externalTrack.id);
        let nextIdx = currentIdx;
        let attempts = 0;
        while (nextIdx === currentIdx && attempts < 20) {
          nextIdx = Math.floor(Math.random() * playlist.length);
          attempts++;
        }
        setShuffledNextTrack({
          ...playlist[nextIdx],
          playbackContext: externalTrack.playbackContext
        });
      } else if (playlist.length === 1) {
        setShuffledNextTrack({
          ...playlist[0],
          playbackContext: externalTrack.playbackContext
        });
      } else {
        setShuffledNextTrack(null);
      }
    } else if (currentTrackPath && tracks.length > 0) {
      const currentIdx = tracks.findIndex(t => t.filepath === currentTrackPath);
      let nextIdx = currentIdx;
      let attempts = 0;
      while (nextIdx === currentIdx && attempts < 20) {
        nextIdx = Math.floor(Math.random() * tracks.length);
        attempts++;
      }
      if (nextIdx >= 0 && nextIdx < tracks.length) {
        const localT = tracks[nextIdx];
        setShuffledNextTrack({
          id: localT.filepath,
          title: localT.title || localT.filepath.split(/[/\\]/).pop() || 'Local Track',
          artist: localT.artist || 'Local Library',
          artwork_url: coverArt || undefined,
          source: 'local',
          filepath: localT.filepath,
          playbackContext: 'local'
        });
      } else {
        setShuffledNextTrack(null);
      }
    } else {
      setShuffledNextTrack(null);
    }
  }, [isShuffle, externalTrack, likedTracks, recentlyPlayed, externalPlaylistTracks, searchResults, playlists, currentTrackPath, tracks, coverArt]);

  const dailyMixes = useMemo(() => {
    const mixes: { id: string; title: string; subtitle: string; artwork_url: string; tracks: any[] }[] = [];
    
    // 1. Build a strict set of keys for tracks the user has ALREADY listened to or liked
    const listenedKeys = new Set<string>();
    likedTracks.forEach((t: any) => {
      if (t.id) listenedKeys.add(String(t.id).toLowerCase());
      if (t.filepath) listenedKeys.add(String(t.filepath).toLowerCase());
      if (t.title) listenedKeys.add(t.title.toLowerCase().trim());
    });
    recentlyPlayed.forEach((t: any) => {
      if (t.id) listenedKeys.add(String(t.id).toLowerCase());
      if (t.filepath) listenedKeys.add(String(t.filepath).toLowerCase());
      if (t.title) listenedKeys.add(t.title.toLowerCase().trim());
    });
    tracks.forEach((t: any) => {
      if (t.filepath) listenedKeys.add(String(t.filepath).toLowerCase());
      if (t.title) listenedKeys.add(t.title.toLowerCase().trim());
    });

    // 2. Analyze top favorite artists & listening history
    const allUserTracks = [...likedTracks, ...recentlyPlayed];
    const uniqueUserTracks = allUserTracks.filter((v, i, a) => 
      a.findIndex(t => (t.id || t.filepath) === (v.id || v.filepath)) === i
    );
    const favArtists = Array.from(
      new Set(uniqueUserTracks.map(t => t.artist).filter(b => b && b.trim().length > 0))
    ).slice(0, 4);
    const favArtistsStr = favArtists.length > 0 ? favArtists.join(', ') : '';

    // 3. Convert candidate recommendation tracks and EXCLUDE any already listened songs
    const allCandidates = trendingNews.map(t => ({
      ...t,
      id: `saavn-${t.title}-${t.artist}`,
      title: t.title,
      artist: t.artist,
      artwork_url: t.artwork_url,
      source: 'spotify' as const
    }));

    const unlistenedCandidates = allCandidates.filter(t => {
      const titleKey = (t.title || '').toLowerCase().trim();
      const idKey = (t.id || '').toLowerCase();
      return titleKey && !listenedKeys.has(titleKey) && !listenedKeys.has(idKey);
    });

    // Fallback candidates if listener has played almost everything
    const candidatePool = unlistenedCandidates.length > 0 ? unlistenedCandidates : allCandidates;

    // Separate into taste categories
    const artistMatches = candidatePool.filter(t => 
      favArtists.some(artist => t.artist.toLowerCase().includes(artist.toLowerCase()))
    );

    // Mix 1: Artist & Style Taste Mix (Unplayed songs from or matching favorite artists)
    const mix1Tracks = [
      ...artistMatches,
      ...candidatePool.slice(0, 15)
    ].filter((v, i, a) => a.findIndex(t => t.id === v.id) === i).slice(0, 15);

    mixes.push({
      id: 'daily-mix-1',
      title: 'Daily Mix 1',
      subtitle: favArtistsStr ? `Fresh unheard tracks matching ${favArtistsStr}.` : 'Fresh recommendations tailored to your taste.',
      artwork_url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400',
      tracks: mix1Tracks
    });

    // Mix 2: Upbeat Taste & Vibe Mix (Unplayed high energy recommendations matching taste)
    const mix2Tracks = candidatePool
      .slice(10, 30)
      .sort(() => 0.5 - Math.random())
      .slice(0, 15);

    mixes.push({
      id: 'daily-mix-2',
      title: 'Daily Mix 2',
      subtitle: 'Unheard upbeat hits selected for your listening profile.',
      artwork_url: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400',
      tracks: mix2Tracks.length > 0 ? mix2Tracks : candidatePool.slice(0, 10)
    });

    // Mix 3: Taste Discovery & Deep Cuts (New releases and hidden gems in listener's genre)
    const mix3Tracks = candidatePool.slice(20, 40).slice(0, 15);

    mixes.push({
      id: 'daily-mix-3',
      title: 'Daily Mix 3',
      subtitle: 'Discover new releases and hidden gems in your favorite style.',
      artwork_url: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=400',
      tracks: mix3Tracks.length > 0 ? mix3Tracks : candidatePool.slice(5, 15)
    });

    return mixes;
  }, [likedTracks, recentlyPlayed, tracks, trendingNews]);

  const addToRecentlyPlayed = useCallback((track: any) => {
    if (!track || !track.title) return;
    const trackObj = {
      id: track.id || track.filepath || track.title,
      title: track.title,
      artist: track.artist || 'Unknown Artist',
      album: track.album || '',
      duration_ms: track.duration_ms || 0,
      artwork_url: track.artwork_url || `https://picsum.photos/seed/${encodeURIComponent(track.title)}/200`,
      source: track.source || 'external',
      stream_url: track.stream_url || track.filepath || track.id,
      filepath: track.filepath
    };
    setRecentlyPlayed(prev => {
      const filtered = prev.filter(t => (t.id || t.title) !== (trackObj.id || trackObj.title));
      const updated = [trackObj, ...filtered].slice(0, 10);
      try {
        localStorage.setItem('muziso_recently_played', JSON.stringify(updated));
      } catch { }
      return updated;
    });
  }, []);

  const activeArtwork = playerTrack?.artwork_url || coverArt;
  const dynamicTheme = useDominantColor(activeArtwork);

  // Inject song-color CSS variables onto :root so the whole app vibes with the track
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--theme-r', String(dynamicTheme.r));
    root.style.setProperty('--theme-g', String(dynamicTheme.g));
    root.style.setProperty('--theme-b', String(dynamicTheme.b));
    root.style.setProperty('--theme-hex', dynamicTheme.hex);
    root.style.setProperty('--theme-accent', dynamicTheme.accentColor);
    root.style.setProperty('--theme-glow', `rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.18)`);
    root.style.setProperty('--theme-glow-strong', `rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.35)`);
    root.style.setProperty('--theme-border', `rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.22)`);
  }, [dynamicTheme]);

  // ── Context Menu ────────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  const openContextMenu = useCallback((e: React.MouseEvent, track: ContextMenuTrack, playlistId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, track, playlistId });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const [queue, setQueue] = useState<ContextMenuTrack[]>([]);
  const [queueToast, setQueueToast] = useState<string | null>(null);

  const handleContextAddToQueue = useCallback((track: ContextMenuTrack) => {
    setQueue(prev => [...prev, track]);
    setQueueToast(`"${track.title}" added to queue`);
    setTimeout(() => setQueueToast(null), 2500);
  }, []);

  const handleContextLike = useCallback((track: ContextMenuTrack) => {
    toggleLike(track as any, undefined);
  }, [toggleLike]);

  const handleContextCopyTitle = useCallback((track: ContextMenuTrack) => {
    navigator.clipboard.writeText(`${track.title}${track.artist ? ` - ${track.artist}` : ''}`).catch(() => {});
  }, []);

  const handleContextSearchArtist = useCallback((track: ContextMenuTrack) => {
    const artist = (track.artist || '').split(',')[0].trim();
    if (artist) { setSearchQuery(artist); setActiveTab('browse'); }
  }, [setSearchQuery, setActiveTab]);

  // Per-track lyrics offset persistence
  const handleLyricsOffsetChange = useCallback((offset: number) => {
    setLyricsOffsetMs(offset);
    const key = playerTrack?.id || playerTrack?.filepath || currentTrackPath;
    if (key) {
      try {
        const stored = JSON.parse(localStorage.getItem('muziso_lyrics_offsets') || '{}');
        stored[key] = offset;
        localStorage.setItem('muziso_lyrics_offsets', JSON.stringify(stored));
      } catch { }
    }
  }, [playerTrack?.id, playerTrack?.filepath, currentTrackPath]);

  // Sync active track to Discord Rich Presence
  useEffect(() => {
    const syncDiscord = async () => {
      if (!isPlaying || !playerTrack) {
        await invoke('clear_discord_activity').catch(() => { });
        return;
      }

      const payload = {
        title: stripExtension(playerTrack.title),
        artist: playerTrack.artist,
        durationMs: (playerTrack.duration_ms && playerTrack.duration_ms > 0) ? playerTrack.duration_ms : (durationMs || 0),
        artworkUrl: playerTrack.artwork_url || coverArt || null
      };

      await invoke('set_discord_activity', payload).catch(e => {
        console.warn("Discord RPC failed or not connected", e);
      });
    };

    syncDiscord();
  }, [isPlaying, playerTrack, durationMs]);

  // Fetch official cover image from Spotify if missing or placeholder
  useEffect(() => {
    async function fetchCoverArtwork() {
      if (playerTrack) {
        try {
          const query = (playerTrack.source === 'spotify' || playerTrack.id?.startsWith('sp-'))
            ? (playerTrack.stream_url || playerTrack.id || `${playerTrack.title} ${playerTrack.artist}`)
            : `${playerTrack.title} ${playerTrack.artist}`;

          const spotifyCover = await invoke<string>('fetch_spotify_cover', { query });
          if (spotifyCover) {
            setCoverArt(spotifyCover);
            return;
          }
        } catch (e) {
          // Spotify fetch failed or returned no result
        }
      }
    }
    fetchCoverArtwork();
  }, [playerTrack]);

  // Pre-fetch Trending News and Releases
  useEffect(() => {
    let mounted = true;
    const safetyTimer = setTimeout(() => {
      if (mounted) setTrendingNewsLoading(false);
    }, 2500);

    // Fetch recent plays list
    let recentPlaysList: string[] = [];
    try {
      const saved = localStorage.getItem('muziso_recent_plays');
      if (saved) {
        const parsed = JSON.parse(saved);
        recentPlaysList = parsed.map((t: any) => `${t.title} ${t.artist}`);
      }
    } catch (e) {}

    invoke<NewsResponse>('get_music_news', { recentPlays: recentPlaysList })
      .then(data => {
        if (mounted) {
          clearTimeout(safetyTimer);
          if (data?.songs && data.songs.length > 0) {
            setTrendingNews(data.songs);
          }
          if (data?.playlists && data.playlists.length > 0) {
            setTrendingPlaylists(data.playlists);
          }
          setTrendingNewsLoading(false);
        }
      })
      .catch(err => {
        console.error("Failed to fetch news:", err);
        if (mounted) {
          clearTimeout(safetyTimer);
          setTrendingNewsLoading(false);
        }
      });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
    };
  }, []);

  // Save Playlists to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('muziso_playlists', JSON.stringify(playlists));
    } catch (e) {}
  }, [playlists]);

  // Playlist management helper functions
  const createPlaylist = (name: string) => {
    if (!name.trim()) return;
    const newPlaylist = {
      id: 'pl-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: name.trim(),
      artwork_url: `https://picsum.photos/seed/${encodeURIComponent(name.trim())}/400`,
      tracks: [],
      createdAt: Date.now()
    };
    setPlaylists(prev => [newPlaylist, ...prev]);
    return newPlaylist;
  };

  const deletePlaylist = (id: string) => {
    setPlaylists(prev => prev.filter(pl => pl.id !== id));
    if (selectedPlaylistId === id) {
      setSelectedPlaylistId(null);
      setActiveTab('library');
    }
  };

  const addTrackToPlaylist = (playlistId: string, track: any) => {
    setPlaylists(prev => prev.map(pl => {
      if (pl.id === playlistId) {
        // Normalise track object so it has a valid ID & source
        const trackId = track.id || track.filepath;
        if (!trackId) return pl;

        // Prevent duplicate songs in the same playlist
        if (pl.tracks.some((t: any) => (t.id || t.filepath) === trackId)) {
          return pl;
        }

        const normalizedTrack = {
          id: trackId,
          title: track.title || 'Unknown Title',
          artist: track.artist || 'Unknown Artist',
          album: track.album || '',
          artwork_url: track.artwork_url || track.artworkUrl || `https://picsum.photos/seed/${track.title || 'default'}/200`,
          duration_ms: track.duration_ms || track.durationMs || 0,
          source: track.source || 'local',
          filepath: track.filepath || track.stream_url || '',
          stream_url: track.stream_url || track.filepath || ''
        };

        const updatedTracks = [...pl.tracks, normalizedTrack];
        const artwork_url = pl.tracks.length === 0 && normalizedTrack.artwork_url ? normalizedTrack.artwork_url : pl.artwork_url;
        return { ...pl, tracks: updatedTracks, artwork_url };
      }
      return pl;
    }));
  };

  const removeTrackFromPlaylist = (playlistId: string, trackId: string) => {
    setPlaylists(prev => prev.map(pl => {
      if (pl.id === playlistId) {
        return {
          ...pl,
          tracks: pl.tracks.filter((t: any) => (t.id || t.filepath) !== trackId)
        };
      }
      return pl;
    }));
  };

  // Trigger search when query or source changes
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(searchQuery, searchSource);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, searchSource]);

  // Parse LRC format
  const parseLrc = (lrc: string) => {
    const lines = lrc.split('\n');
    const result: { timeMs: number, text: string }[] = [];
    const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    for (const line of lines) {
      const match = timeReg.exec(line);
      if (match) {
        const m = parseInt(match[1]);
        const s = parseInt(match[2]);
        const msStr = match[3].length === 2 ? match[3] + '0' : match[3];
        const ms = parseInt(msStr);
        const timeMs = (m * 60 * 1000) + (s * 1000) + ms;
        const text = line.replace(timeReg, '').trim();
        if (text) {
          result.push({ timeMs, text });
        }
      }
    }
    return result;
  };

  const handleStreamExternalAudio = async (track: any, context: string = 'search', isExplicitUserChoice: boolean = true) => {
    let playContext = context;
    if (context === 'liked' || context === 'external-playlist' || (typeof context === 'string' && context.startsWith('playlist-'))) {
      let playlistTracks: any[] = [];
      if (context === 'liked') {
        playlistTracks = likedTracks;
      } else if (context === 'external-playlist') {
        playlistTracks = externalPlaylistTracks;
      } else if (context.startsWith('playlist-')) {
        const plId = context.replace('playlist-', '');
        const pl = playlists.find((p: any) => p.id === plId);
        playlistTracks = pl ? pl.tracks : [];
      }

      if (playlistTracks.length > 0) {
        setOriginalPlaylistContext(context);
        setOriginalPlaylistTracks(playlistTracks);

        const currentIdx = playlistTracks.findIndex((t: any) => t.id === track.id);
        if (currentIdx !== -1) {
          let upcoming = playlistTracks.slice(currentIdx + 1);
          
          if (isShuffle && upcoming.length > 1) {
            // Shuffle the upcoming tracks
            const shuffled = [...upcoming];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            upcoming = shuffled;
          }

          setQueue(upcoming.map((t: any) => ({
            ...t,
            playbackContext: 'queue'
          })));
          playContext = 'queue';
        }
      }
    } else if (context !== 'queue') {
      setQueue([]);
      setOriginalPlaylistContext(null);
      setOriginalPlaylistTracks([]);
    }

    if (isExplicitUserChoice) {
      addToRecentlyPlayed(track);
    }
    // For liked tracks, check if we have a local download first
    let localPath = track.local_audio_path;

    // If no local_audio_path in metadata, check disk cache
    if (context === 'liked' && !localPath && track.id) {
      try {
        const cached = await invoke<string | null>('check_liked_cache', { trackId: track.id });
        if (cached) {
          localPath = cached;
          console.log("Offline: Found cached file on disk:", cached);
        }
      } catch (e) {
        console.error("Failed to check liked cache:", e);
      }
    }

    if (context === 'liked' && localPath) {
      setExternalTrack({
        ...track,
        title: track.title || 'Unknown Title',
        artist: track.artist || 'Unknown Artist',
        artwork_url: track.artwork_url || `https://picsum.photos/seed/${track.title || 'default'}/200`,
        album: track.album || '',
        duration_ms: track.duration_ms || 0,
        source: track.source || 'external',
        stream_url: localPath,
        playbackContext: playContext
      });
      try {
        await playTrack(localPath);
        setStreamError(null);
        return;
      } catch (e) {
        console.error("Failed to play local liked track, falling back to stream:", e);
      }
    }

    // Reconstruct a proper source URL from the track ID if stream_url is missing or stale
    let playbackUrl = track.stream_url || track.id;
    if (context === 'liked' || !playbackUrl.startsWith('http')) {
      const id = track.id || '';
      if (track.source === 'youtube' || id.startsWith('yt-')) {
        playbackUrl = `https://www.youtube.com/watch?v=${id.replace('yt-', '')}`;
      } else if (track.source === 'soundcloud' || id.startsWith('sc-')) {
        playbackUrl = `https://api-v2.soundcloud.com/tracks/${id.replace('sc-', '')}`;
      } else if (track.source === 'spotify' || id.startsWith('sp-')) {
        playbackUrl = `https://open.spotify.com/track/${id.replace('sp-', '')}`;
      }
    }
    setExternalTrack({
      ...track,
      title: track.title || 'Unknown Title',
      artist: track.artist || 'Unknown Artist',
      artwork_url: track.artwork_url || `https://picsum.photos/seed/${track.title || 'default'}/200`,
      album: track.album || '',
      duration_ms: track.duration_ms || 0,
      source: track.source || 'external',
      stream_url: playbackUrl,
      playbackContext: playContext
    });
    const resolvedUrl = await streamExternalAudio(playbackUrl, track.source, track.id, track.title, track.artist);
    if (resolvedUrl) {
      const isPreview = resolvedUrl.startsWith('PREVIEW:');
      const actualUrl = isPreview ? resolvedUrl.replace('PREVIEW:', '') : resolvedUrl;
      setExternalTrack((prev: any) => prev ? { ...prev, stream_url: actualUrl } : null);

      if (isPreview) {
        // Track is playing but it's only a 30s preview
        const trackTitle = track.title || 'Unknown Track';
        const trackArtist = track.artist || 'Unknown Artist';
        setStreamError({
          message: `"${trackTitle}" is blocked by the distributor on SoundCloud. Playing 30-second preview.`,
          trackTitle,
          trackArtist,
          source: track.source,
          previewUrl: actualUrl
        });
        setTimeout(() => setStreamError(null), 15000);
      } else {
        setStreamError(null);
      }
    } else {
      // Stream completely failed
      const trackTitle = track.title || 'Unknown Track';
      const trackArtist = track.artist || 'Unknown Artist';
      setStreamError({
        message: track.source === 'soundcloud'
          ? `"${trackTitle}" is blocked by the distributor on SoundCloud. The track is not available.`
          : `Failed to stream "${trackTitle}". The track may be unavailable.`,
        trackTitle,
        trackArtist,
        source: track.source
      });
      setTimeout(() => setStreamError(null), 12000);
    }
  };

  // Clear externalTrack when playing a local track
  const handlePlayLocalTrack = (filepath: string, trackObj?: any) => {
    if (trackObj) {
      addToRecentlyPlayed(trackObj);
    } else {
      const t = tracks.find(item => item.filepath === filepath);
      if (t) addToRecentlyPlayed(t);
    }
    setExternalTrack(null);
    setQueue([]);
    playTrack(filepath);
  };

  // Plays a song from the context menu — defined here so both handlePlayLocalTrack
  // and handleStreamExternalAudio are already in scope.
  const handleContextPlay = (track: ContextMenuTrack) => {
    if (!track.source || track.source === 'local') {
      handlePlayLocalTrack(track.filepath || track.id || '');
    } else {
      handleStreamExternalAudio(track as any, 'search');
    }
  };

  // Helper to get playback URL for an external track
  const getTrackPlaybackUrl = (track: any) => {
    const streamUrl = track.stream_url;
    if (streamUrl && (streamUrl.includes('googlevideo.com') || streamUrl.includes('sndcdn.com') || streamUrl.includes('cf-media.sndcdn.com'))) {
      return (
        track.source === 'youtube' ? `https://www.youtube.com/watch?v=${track.id.replace('yt-', '')}` :
          track.source === 'soundcloud' ? `https://api-v2.soundcloud.com/tracks/${track.id.replace('sc-', '')}` :
            track.source === 'spotify' ? `https://open.spotify.com/track/${track.id.replace('sp-', '')}` :
              track.id
      );
    }
    return streamUrl || (
      track.source === 'youtube' ? `https://www.youtube.com/watch?v=${track.id.replace('yt-', '')}` :
        track.source === 'soundcloud' ? `https://api-v2.soundcloud.com/tracks/${track.id.replace('sc-', '')}` :
          track.source === 'spotify' ? `https://open.spotify.com/track/${track.id.replace('sp-', '')}` :
            track.id
    );
  };

  // Unified next/prev for both local and external tracks
  const handleNextTrack = useCallback(() => {
    if (repeatMode === 'one') {
      if (externalTrack) {
        handleStreamExternalAudio({ ...externalTrack, stream_url: getTrackPlaybackUrl(externalTrack) }, externalTrack.playbackContext, false);
      } else if (currentTrackPath) {
        playTrack(currentTrackPath);
      } else {
        seek(0);
      }
      return;
    }

    // 1. Check if there are user-queued tracks waiting to be played next!
    if (queue.length > 0) {
      const nextQueuedTrack = queue[0];
      setQueue(prev => prev.slice(1));
      handleStreamExternalAudio(
        { ...nextQueuedTrack, stream_url: getTrackPlaybackUrl(nextQueuedTrack) },
        (nextQueuedTrack as any).playbackContext || 'queue',
        false
      );
      if (nextQueuedTrack.artwork_url) {
        setCoverArt(nextQueuedTrack.artwork_url);
      }
      return;
    }

    // 1.25. If queue is empty but we have an active playlist and repeat is ON, repeat/loop!
    if (queue.length === 0 && originalPlaylistTracks.length > 0 && (repeatMode === 'all' || (autoLoopLiked && originalPlaylistContext === 'liked'))) {
      let nextTrack = null;
      let remainingTracks = [];
      
      if (isShuffle && originalPlaylistTracks.length > 1) {
        const nextIdx = Math.floor(Math.random() * originalPlaylistTracks.length);
        nextTrack = originalPlaylistTracks[nextIdx];
        
        const otherTracks = originalPlaylistTracks.filter((_, idx) => idx !== nextIdx);
        const shuffled = [...otherTracks];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        remainingTracks = shuffled;
      } else {
        nextTrack = originalPlaylistTracks[0];
        remainingTracks = originalPlaylistTracks.slice(1);
      }
      
      if (nextTrack) {
        setQueue(remainingTracks.map((t: any) => ({ ...t, playbackContext: 'queue' })));
        handleStreamExternalAudio(
          { ...nextTrack, stream_url: getTrackPlaybackUrl(nextTrack) },
          'queue',
          false
        );
        if (nextTrack.artwork_url) {
          setCoverArt(nextTrack.artwork_url);
        }
        return;
      }
    }

    // 1.5. If shuffle is ON and we pre-calculated the next track, play it!
    if (isShuffle && shuffledNextTrack) {
      const next = shuffledNextTrack;
      if (next.source === 'local') {
        playTrack(next.filepath);
      } else {
        handleStreamExternalAudio(
          { ...next, stream_url: getTrackPlaybackUrl(next) },
          next.playbackContext,
          false
        );
        if (next.artwork_url) {
          setCoverArt(next.artwork_url);
        }
      }
      return;
    }

    // 2. Check if we have smart autoplay recommendations for individually played tracks
    const isIndividualSelection = !externalTrack || 
      externalTrack.playbackContext === 'search' || 
      externalTrack.playbackContext === 'recent' || 
      externalTrack.playbackContext === 'autoplay';

    if (isIndividualSelection && autoplayRecommendations.length > 0) {
      const nextRec = autoplayRecommendations[0];
      setAutoplayRecommendations(prev => prev.slice(1));
      
      if (nextRec.source === 'local') {
        playTrack(nextRec.filepath);
      } else {
        handleStreamExternalAudio(
          { ...nextRec, stream_url: getTrackPlaybackUrl(nextRec) },
          'autoplay',
          false
        );
      }
      if (nextRec.artwork_url) {
        setCoverArt(nextRec.artwork_url);
      }
      return;
    }

    if (externalTrack) {
      const isLikedContext = externalTrack.playbackContext === 'liked';
      const isRecentContext = externalTrack.playbackContext === 'recent';
      const isPlaylistContext = externalTrack.playbackContext?.startsWith('playlist-');
      const isExternalPlaylistContext = externalTrack.playbackContext === 'external-playlist';
      
      let playlist = isLikedContext 
        ? likedTracks 
        : (isRecentContext 
            ? recentlyPlayed 
            : (isExternalPlaylistContext 
                ? externalPlaylistTracks 
                : searchResults));
      if (isPlaylistContext) {
        const plId = externalTrack.playbackContext.replace('playlist-', '');
        const pl = playlists.find(p => p.id === plId);
        playlist = pl ? pl.tracks : [];
      }

      if (playlist.length > 0) {
        let nextIdx = -1;
        const currentIdx = playlist.findIndex((t: any) => t.id === externalTrack.id);

        if (isShuffle && playlist.length > 1) {
          do {
            nextIdx = Math.floor(Math.random() * playlist.length);
          } while (nextIdx === currentIdx);
        } else {
          nextIdx = currentIdx + 1;
          if (nextIdx >= playlist.length) {
            if (repeatMode === 'all' || (autoLoopLiked && isLikedContext)) {
              nextIdx = 0;
            } else {
              nextIdx = -1;
            }
          }
        }

        if (nextIdx >= 0 && nextIdx < playlist.length) {
          const next: any = playlist[nextIdx];
          handleStreamExternalAudio({ ...next, stream_url: getTrackPlaybackUrl(next) }, externalTrack.playbackContext, false);
          setCoverArt(next.artwork_url);
        }
      } else {
        playNext(tracks);
      }
    } else {
      if (tracks.length > 0) {
        let nextIdx = -1;
        const currentIdx = tracks.findIndex(t => t.filepath === currentTrackPath);

        if (isShuffle && tracks.length > 1) {
          do {
            nextIdx = Math.floor(Math.random() * tracks.length);
          } while (nextIdx === currentIdx);
        } else {
          nextIdx = currentIdx + 1;
          if (nextIdx >= tracks.length) {
            if (repeatMode === 'all') {
              nextIdx = 0;
            } else {
              nextIdx = -1;
            }
          }
        }

        if (nextIdx >= 0 && nextIdx < tracks.length) {
          playTrack(tracks[nextIdx].filepath);
        }
      }
    }
  }, [repeatMode, queue, externalTrack, likedTracks, searchResults, externalPlaylistTracks, isShuffle, shuffledNextTrack, originalPlaylistTracks, originalPlaylistContext, autoLoopLiked, tracks, currentTrackPath, seek, streamExternalAudio, playNext, playTrack, autoplayRecommendations, setAutoplayRecommendations]);

  const fetchAutoplayRecommendations = useCallback(async (track: any) => {
    if (!track) return;
    setIsFetchingAutoplay(true);
    try {
      if (track.source === 'local') {
        const cleanArtist = track.artist?.toLowerCase() || '';
        const cleanAlbum = track.album?.toLowerCase() || '';
        const localRelated = tracks.filter(t => 
          t.filepath !== track.filepath && 
          ((cleanArtist && t.artist?.toLowerCase().includes(cleanArtist)) || 
           (cleanAlbum && t.album?.toLowerCase().includes(cleanAlbum)))
        );
        if (localRelated.length > 0) {
          setAutoplayRecommendations(localRelated.map(t => ({
            id: t.filepath,
            title: t.title || t.filepath.split(/[/\\]/).pop() || 'Local Track',
            artist: t.artist || 'Local Library',
            artwork_url: track.artwork_url || undefined,
            source: 'local',
            filepath: t.filepath,
            playbackContext: 'autoplay'
          })));
          setIsFetchingAutoplay(false);
          return;
        }
      }

      const cleanAlbum = track.album?.toLowerCase() || '';
      const isSingle = cleanAlbum.includes('single') || cleanAlbum.includes('ep') || cleanAlbum.includes('soundtrack') || cleanAlbum.length < 3;
      const query = (!isSingle && track.album) ? track.album : track.artist;
      const source = track.source || 'spotify';
      
      console.log(`[Autoplay] Fetching related songs for: "${track.title}" using query: "${query}" (source: ${source})`);
      const results = await invoke<any[]>('search_external', {
        query,
        source: source === 'local' ? 'spotify' : source,
        page: 0
      });
      
      const filtered = results.filter(t => t.id !== track.id && t.title?.toLowerCase() !== track.title?.toLowerCase());
      
      setAutoplayRecommendations(filtered.map(t => ({
        ...t,
        playbackContext: 'autoplay'
      })));
    } catch (err) {
      console.error("[Autoplay] Failed to fetch recommendations:", err);
    } finally {
      setIsFetchingAutoplay(false);
    }
  }, [tracks]);

  const getAutoplayTrack = useCallback(() => {
    if (repeatMode === 'one' && playerTrack) {
      return playerTrack;
    }

    const isIndividualSelection = !externalTrack || 
      externalTrack.playbackContext === 'search' || 
      externalTrack.playbackContext === 'recent' || 
      externalTrack.playbackContext === 'autoplay';

    if (isIndividualSelection && autoplayRecommendations.length > 0) {
      return {
        ...autoplayRecommendations[0],
        playbackContext: 'autoplay'
      };
    }

    if (isShuffle && shuffledNextTrack) {
      return shuffledNextTrack;
    }

    if (externalTrack) {
      const isLikedContext = externalTrack.playbackContext === 'liked';
      const isRecentContext = externalTrack.playbackContext === 'recent';
      const isPlaylistContext = externalTrack.playbackContext?.startsWith('playlist-');
      const isExternalPlaylistContext = externalTrack.playbackContext === 'external-playlist';
      
      let playlist = isLikedContext 
        ? likedTracks 
        : (isRecentContext 
            ? recentlyPlayed 
            : (isExternalPlaylistContext 
                ? externalPlaylistTracks 
                : searchResults));
      if (isPlaylistContext) {
        const plId = externalTrack.playbackContext.replace('playlist-', '');
        const pl = playlists.find(p => p.id === plId);
        playlist = pl ? pl.tracks : [];
      }

      if (playlist.length > 0) {
        let nextIdx = -1;
        const currentIdx = playlist.findIndex((t: any) => t.id === externalTrack.id);

        if (isShuffle && playlist.length > 1) {
          nextIdx = (currentIdx + 1) % playlist.length;
        } else {
          nextIdx = currentIdx + 1;
          if (nextIdx >= playlist.length) {
            if (repeatMode === 'all' || (autoLoopLiked && isLikedContext)) {
              nextIdx = 0;
            } else {
              nextIdx = -1;
            }
          }
        }

        if (nextIdx >= 0 && nextIdx < playlist.length) {
          return {
            ...playlist[nextIdx],
            playbackContext: externalTrack.playbackContext
          };
        }
      }
    } else if (currentTrackPath) {
      if (tracks.length > 0) {
        let nextIdx = -1;
        const currentIdx = tracks.findIndex(t => t.filepath === currentTrackPath);

        if (isShuffle && tracks.length > 1) {
          nextIdx = (currentIdx + 1) % tracks.length;
        } else {
          nextIdx = currentIdx + 1;
          if (nextIdx >= tracks.length) {
            if (repeatMode === 'all') {
              nextIdx = 0;
            } else {
              nextIdx = -1;
            }
          }
        }

        if (nextIdx >= 0 && nextIdx < tracks.length) {
          const localT = tracks[nextIdx];
          return {
            id: localT.filepath,
            title: localT.title || localT.filepath.split(/[/\\]/).pop() || 'Local Track',
            artist: localT.artist || 'Local Library',
            artwork_url: coverArt || undefined,
            source: 'local',
            filepath: localT.filepath,
            playbackContext: 'local'
          };
        }
      }
    }

    return null;
  }, [repeatMode, externalTrack, likedTracks, recentlyPlayed, externalPlaylistTracks, searchResults, playlists, isShuffle, shuffledNextTrack, autoLoopLiked, currentTrackPath, tracks, coverArt, playerTrack, autoplayRecommendations]);

  useEffect(() => {
    handleNextTrackRef.current = handleNextTrack;
  });

  const handlePrevTrack = useCallback(() => {
    if (positionMs > 3000) {
      seek(0);
      return;
    }

    if (repeatMode === 'one') {
      if (externalTrack) {
        handleStreamExternalAudio({ ...externalTrack, stream_url: getTrackPlaybackUrl(externalTrack) }, externalTrack.playbackContext, false);
      } else if (currentTrackPath) {
        playTrack(currentTrackPath);
      } else {
        seek(0);
      }
      return;
    }

    if (externalTrack) {
      const isQueue = externalTrack.playbackContext === 'queue';
      
      let playlist = [];
      let context = externalTrack.playbackContext;
      
      if (isQueue && originalPlaylistTracks.length > 0) {
        playlist = originalPlaylistTracks;
        context = originalPlaylistContext || 'queue';
      } else {
        const isLikedContext = externalTrack.playbackContext === 'liked';
        const isRecentContext = externalTrack.playbackContext === 'recent';
        const isPlaylistContext = externalTrack.playbackContext?.startsWith('playlist-');
        const isExternalPlaylistContext = externalTrack.playbackContext === 'external-playlist';

        playlist = isLikedContext 
          ? likedTracks 
          : (isRecentContext 
              ? recentlyPlayed 
              : (isExternalPlaylistContext 
                  ? externalPlaylistTracks 
                  : searchResults));
        if (isPlaylistContext) {
          const plId = externalTrack.playbackContext.replace('playlist-', '');
          const pl = playlists.find(p => p.id === plId);
          playlist = pl ? pl.tracks : [];
        }
      }

      if (playlist.length > 0) {
        let prevIdx = -1;
        const currentIdx = playlist.findIndex((t: any) => t.id === externalTrack.id);

        if (isShuffle && playlist.length > 1) {
          do {
            prevIdx = Math.floor(Math.random() * playlist.length);
          } while (prevIdx === currentIdx);
        } else {
          prevIdx = currentIdx - 1;
          if (prevIdx < 0) {
            if (repeatMode === 'all' || context === 'liked') {
              prevIdx = playlist.length - 1;
            } else {
              prevIdx = -1;
            }
          }
        }

        if (prevIdx >= 0 && prevIdx < playlist.length) {
          const prev: any = playlist[prevIdx];
          
          if (isQueue) {
            const nextTracks = playlist.slice(prevIdx + 1);
            if (isShuffle && nextTracks.length > 1) {
              const shuffled = [...nextTracks];
              for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
              }
              setQueue(shuffled.map((t: any) => ({ ...t, playbackContext: 'queue' })));
            } else {
              setQueue(nextTracks.map((t: any) => ({ ...t, playbackContext: 'queue' })));
            }
          }
          
          handleStreamExternalAudio({ ...prev, stream_url: getTrackPlaybackUrl(prev) }, context);
          setCoverArt(prev.artwork_url);
        }
      } else {
        playPrev(tracks);
      }
    } else {
      if (tracks.length > 0) {
        let prevIdx = -1;
        const currentIdx = tracks.findIndex(t => t.filepath === currentTrackPath);

        if (isShuffle && tracks.length > 1) {
          do {
            prevIdx = Math.floor(Math.random() * tracks.length);
          } while (prevIdx === currentIdx);
        } else {
          prevIdx = currentIdx - 1;
          if (prevIdx < 0) {
            if (repeatMode === 'all') {
              prevIdx = tracks.length - 1;
            } else {
              prevIdx = -1;
            }
          }
        }

        if (prevIdx >= 0 && prevIdx < tracks.length) {
          playTrack(tracks[prevIdx].filepath);
        }
      }
    }
  }, [positionMs, repeatMode, externalTrack, likedTracks, searchResults, externalPlaylistTracks, isShuffle, originalPlaylistTracks, originalPlaylistContext, tracks, currentTrackPath, seek, handleStreamExternalAudio, playPrev, playTrack]);

  onNextRef.current = handleNextTrack;
  onPrevRef.current = handlePrevTrack;
  onTogglePlayRef.current = () => togglePause();

  const handleUploadLyrics = async () => {
    if (!playerTrack) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Lyrics',
          extensions: ['lrc', 'srt', 'vtt', 'txt']
        }]
      });

      if (selected && typeof selected === 'string') {
        const content = await invoke<string>('read_text_file', { path: selected });

        // Update backend
        await invoke('update_track_lyrics', {
          trackId: playerTrack.id || '',
          filepath: playerTrack.filepath || null,
          lyrics: content
        });

        // Process for immediate UI update
        let finalLyrics = content;
        if (content.includes('-->')) {
          finalLyrics = await invoke<string>('convert_srt_vtt_to_lrc', { content });
        }

        const isSynced = finalLyrics.trim().startsWith('[');
        if (isSynced) {
          setParsedLyrics(parseLrc(finalLyrics));
          setLyricsData({ syncedLyrics: finalLyrics });
        } else {
          setParsedLyrics([]);
          setLyricsData({ plainLyrics: finalLyrics });
        }

        // Update the current playerTrack object in memory so it reflects the change if we re-render
        if (playerTrack) {
          (playerTrack as any).local_lyrics = finalLyrics;
        }
      }
    } catch (e) {
      console.error("Failed to upload lyrics:", e);
    }
  };

  useEffect(() => {
    let stale = false;
    if (playerTrack) {
      // Set initial/cached artwork immediately
      setCoverArt(playerTrack.artwork_url || `https://picsum.photos/seed/${playerTrack.title}/200`);

      // Fetch related autoplay recommendations in the background
      fetchAutoplayRecommendations(playerTrack);

      // Fetch high-res artwork
      fetchAlbumArt(playerTrack.title, playerTrack.artist).then(url => {
        if (!stale && url) setCoverArt(url);
      });

      // Fetch lyrics
      let spotifyId = undefined;
      if (playerTrack.source === 'spotify' || (playerTrack as any).id?.startsWith('sp-')) {
        let rawId = (playerTrack as any).id.replace('sp-', '');
        const match = rawId.match(/track\/([a-zA-Z0-9]+)/);
        if (match) {
          spotifyId = match[1];
        } else {
          spotifyId = rawId;
        }
      }

      invoke('log_frontend', { msg: `App.tsx: Evaluating playerTrack for lyrics. source=${playerTrack.source}, raw_id=${playerTrack.id}, extracted_spotifyId=${spotifyId}` }).catch(() => { });

      fetchLyrics(playerTrack.title, playerTrack.artist, playerTrack.album, durationMs || playerTrack.duration_ms, spotifyId).then(data => {
        if (stale) return; // Track changed while fetching — discard stale result
        setLyricsData(data);
        // Restore per-track lyrics offset (or default to 0)
        const trackKey = playerTrack.id || playerTrack.filepath || currentTrackPath;
        let savedOffset = 0;
        if (trackKey) {
          try {
            const stored = JSON.parse(localStorage.getItem('nekobeat_lyrics_offsets') || '{}');
            if (typeof stored[trackKey] === 'number') savedOffset = stored[trackKey];
          } catch { }
        }
        setLyricsOffsetMs(savedOffset);

        const localIsSynced = playerTrack.local_lyrics && playerTrack.local_lyrics.trim().startsWith('[');

        if (localIsSynced && playerTrack.local_lyrics) {
          setParsedLyrics(parseLrc(playerTrack.local_lyrics));
        } else if (data && data.syncedLyrics) {
          setParsedLyrics(parseLrc(data.syncedLyrics));
        } else {
          setParsedLyrics([]);
        }
      });
    } else {
      setCoverArt(null);
      setLyricsData(null);
      setParsedLyrics([]);
    }
    return () => { stale = true; };
  }, [playerTrack?.id, playerTrack?.filepath, currentTrackPath, fetchAutoplayRecommendations]);

  // Sync Play/Pause State with Native Windows Taskbar Thumbnail Preview Buttons
  useEffect(() => {
    invoke('update_taskbar_playback_state', { isPlaying }).catch(() => { });
  }, [isPlaying]);

  // Global Hardware Media Key & Taskbar Shortcut Listeners & Audio Error Listener
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    listen('shortcut-play-pause', () => togglePause()).then(u => unsubs.push(u));
    listen('shortcut-next', () => handleNextTrack()).then(u => unsubs.push(u));
    listen('shortcut-prev', () => handlePrevTrack()).then(u => unsubs.push(u));
    listen('taskbar-like', () => {
      if (playerTrack) {
        toggleLike(playerTrack, lyricsData?.syncedLyrics || lyricsData?.plainLyrics);
      }
    }).then(u => unsubs.push(u));

    listen('audio-error', (event: any) => {
      console.error("Playback error event received:", event.payload);
      const trackTitle = playerTrack?.title || "Unknown Track";
      const trackArtist = playerTrack?.artist || "Unknown Artist";
      setStreamError({
        message: `Playback failed: ${event.payload}. The track format or link may be invalid.`,
        trackTitle,
        trackArtist,
        source: playerTrack?.source
      });
    }).then(u => unsubs.push(u));

    return () => {
      unsubs.forEach(fn => fn());
    };
  }, [togglePause, handleNextTrack, handlePrevTrack, playerTrack, lyricsData, toggleLike]);

  // Scroll main container to top when changing active tab or selecting a new playlist
  useEffect(() => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
  }, [activeTab, selectedPlaylistId, selectedExternalPlaylist]);

  // Sync with System Media Session (Windows Taskbar Thumbnail Preview / Lock Screen / Notifications)
  useEffect(() => {
    if ('mediaSession' in navigator && playerTrack) {
      try {
        const artworkUrl = playerTrack.artwork_url?.startsWith('http')
          ? playerTrack.artwork_url
          : (playerTrack.artwork_url ? convertFileSrc(playerTrack.artwork_url) : (coverArt || convertFileSrc(logoImg)));

        navigator.mediaSession.metadata = new MediaMetadata({
          title: stripExtension(playerTrack.title),
          artist: playerTrack.artist || 'Muziso',
          album: 'Muziso',
          artwork: [
            { src: artworkUrl, sizes: '512x512', type: 'image/png' },
            { src: artworkUrl, sizes: '256x256', type: 'image/png' },
            { src: artworkUrl, sizes: '128x128', type: 'image/png' },
            { src: artworkUrl, sizes: '96x96', type: 'image/png' }
          ]
        });

        // Update window title so Windows SMTC & Taskbar preview shows "Muziso" track info
        document.title = `${stripExtension(playerTrack.title)} - ${playerTrack.artist} | Muziso`;

        // Wake up the Media Session with silent audio clip for Windows Taskbar Thumbnail Preview Toolbar
        if (silentAudioRef.current) {
          silentAudioRef.current.volume = 0.01;
          if (isPlaying) {
            silentAudioRef.current.play()
              .then(() => invoke('log_frontend', { msg: `MediaSession: Silent audio playing. Metadata set for: ${playerTrack.title}` }))
              .catch((e) => invoke('log_frontend', { msg: `MediaSession: Silent audio play failed: ${e}` }));
          } else {
            silentAudioRef.current.pause();
          }
        }

        navigator.mediaSession.setActionHandler('play', () => togglePause());
        navigator.mediaSession.setActionHandler('pause', () => togglePause());
        navigator.mediaSession.setActionHandler('previoustrack', () => handlePrevTrack());
        navigator.mediaSession.setActionHandler('nexttrack', () => handleNextTrack());

        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime !== undefined) {
            seek(details.seekTime * 1000);
          }
        });
        navigator.mediaSession.setActionHandler('seekbackward', () => {
          seek(Math.max(0, positionMs - 10000));
        });
        navigator.mediaSession.setActionHandler('seekforward', () => {
          seek(Math.min(durationMs || 0, positionMs + 10000));
        });

        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

        // Sync position state
        if (durationMs > 0 && 'setPositionState' in navigator.mediaSession) {
          navigator.mediaSession.setPositionState({
            duration: durationMs / 1000,
            playbackRate: 1,
            position: Math.min(durationMs / 1000, positionMs / 1000)
          });
        }
      } catch (err) {
        invoke('log_frontend', { msg: `MediaSession Error: ${err}` }).catch(() => { });
      }
    }
  }, [playerTrack, isPlaying, coverArt, positionMs, durationMs, togglePause, handleNextTrack, handlePrevTrack, seek]);

  // Find active lyric index
  let activeLyricIndex = -1;
  const adjustedPositionMs = positionMs - lyricsOffsetMs;
  for (let i = 0; i < parsedLyrics.length; i++) {
    if (adjustedPositionMs >= parsedLyrics[i].timeMs) {
      activeLyricIndex = i;
    } else {
      break;
    }
  }

  // Auto-scroll lyrics
  useEffect(() => {
    if (isExpanded && activeLyricIndex !== -1) {
      const activeEl = document.getElementById(`lyric-${activeLyricIndex}`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeLyricIndex, isExpanded]);

  // Keep a ref with the latest positionMs so async callbacks get the current value
  const positionMsRef = useRef(positionMs);
  useEffect(() => { positionMsRef.current = positionMs; }, [positionMs]);

  // Helper to send commands to the YouTube iframe
  const sendYTCommand = (func: string, args: any[] = []) => {
    const iframe = (window as any).__nekobeat_yt_iframe as HTMLIFrameElement | undefined;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  };

  // Sync YouTube iframe video — only on seek or pause/play, NOT periodically
  const ytLastSyncRef = useRef<number>(0);
  useEffect(() => {
    if (!videoMode || !isExpanded || !playerTrack) return;
    if (!getYouTubeVideoId(playerTrack)) return;

    // Only sync when forced (seek sets ytLastSyncRef to -999)
    if (ytLastSyncRef.current === -999) {
      const currentSec = Math.floor(positionMs / 1000);
      ytLastSyncRef.current = currentSec;
      sendYTCommand('seekTo', [currentSec, true]);
    }
  }, [positionMs, videoMode, isExpanded, playerTrack]);

  // Pause/play the YouTube video when audio state changes
  useEffect(() => {
    if (!videoMode || !isExpanded || !playerTrack) return;
    if (!getYouTubeVideoId(playerTrack)) return;
    sendYTCommand(isPlaying ? 'playVideo' : 'pauseVideo');
  }, [isPlaying, videoMode, isExpanded, playerTrack]);

  // One-time initial sync when YT iframe becomes ready after track change
  useEffect(() => {
    if (!videoMode || !isExpanded || !playerTrack) return;
    if (!getYouTubeVideoId(playerTrack)) return;

    let cleaned = false;
    let synced = false;

    const doSync = () => {
      if (cleaned || synced) return;
      synced = true;
      const sec = Math.floor(positionMsRef.current / 1000);
      sendYTCommand('seekTo', [sec, true]);
      // Only send play once — the iframe autoplay=1 handles most cases
      if (isPlaying) sendYTCommand('playVideo');
    };

    // Listen for YT iframe ready event
    const onMessage = (e: MessageEvent) => {
      if (cleaned || synced) return;
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (data?.event === 'onReady' || data?.event === 'initialDelivery' || data?.info?.playerState !== undefined) {
          doSync();
        }
      } catch { }
    };
    window.addEventListener('message', onMessage);

    // Enable iframe API event listening
    const iframe = (window as any).__nekobeat_yt_iframe as HTMLIFrameElement | undefined;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening' }), '*');
    }

    // Single fallback: if no message arrives within 2s, sync once
    const fallback = setTimeout(() => { doSync(); }, 2000);

    return () => {
      cleaned = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(fallback);
    };
  }, [videoMode, isExpanded, playerTrack?.id]);

  // Periodic drift correction: only seekTo (no play/pause commands to avoid icon flash)
  useEffect(() => {
    if (!videoMode || !isExpanded || !playerTrack || !isPlaying) return;
    if (!getYouTubeVideoId(playerTrack)) return;
    const interval = setInterval(() => {
      const sec = Math.floor(positionMsRef.current / 1000);
      sendYTCommand('seekTo', [sec, true]);
    }, 15000);
    return () => clearInterval(interval);
  }, [videoMode, isExpanded, playerTrack?.id, isPlaying]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!playerTrack) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - bounds.left) / bounds.width));
    const targetDur = (durationMs && durationMs > 0) ? durationMs : (playerTrack.duration_ms || 0);
    const targetMs = Math.floor(percent * targetDur);
    seek(targetMs);
    // Force video resync after seek
    ytLastSyncRef.current = -999;
  };

  const handleScanClick = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });
    if (selected) {
      await scanDirectory(selected as string);
    }
  };

  const isLocalSynced = playerTrack?.local_lyrics && playerTrack.local_lyrics.trim().startsWith('[');
  const rawPlainLyrics = (playerTrack?.local_lyrics && !isLocalSynced) ? playerTrack.local_lyrics : lyricsData?.plainLyrics;
  
  // Genius scraper sometimes returns just "1 ContributorXXX Lyrics" when it can't find real lyrics
  const isJunkLyrics = rawPlainLyrics && rawPlainLyrics.split('\n').filter(l => l.trim().length > 0).length <= 1 && rawPlainLyrics.match(/\d+\s*Contributor.*Lyrics/i);
  
  const plainLyricsText = isJunkLyrics ? undefined : rawPlainLyrics;
  const hasPlainLyrics = !!plainLyricsText;

  if (isMiniplayerMode) {
    return (
      <div
        onMouseDown={(e) => {
          if (e.button === 0) { // Left click
            getCurrentWindow().startDragging();
          }
        }}
        className="w-full h-screen bg-[#09090b]/90 backdrop-blur-3xl flex items-center p-4 gap-4 border border-white/10 rounded-2xl overflow-hidden shadow-2xl cursor-default select-none group/pip"
        style={{
          backgroundImage: `url('${playerTrack?.artwork_url || coverArt || ""}')`,
          backgroundSize: "cover",
          backgroundPosition: "center"
        }}
      >
        <div data-tauri-drag-region className="absolute inset-0 bg-black/70 backdrop-blur-[80px]" />

        <div data-tauri-drag-region className="relative w-24 h-24 rounded-2xl overflow-hidden shrink-0 shadow-2xl border border-white/10">
          {(playerTrack?.artwork_url || coverArt) ? (
            <img data-tauri-drag-region src={playerTrack?.artwork_url || coverArt || ""} className="w-full h-full object-cover" alt="Cover" />
          ) : (
            <div data-tauri-drag-region className="w-full h-full bg-neutral-900 flex items-center justify-center">
              <img data-tauri-drag-region src={logoImg} alt="Muziso" className="w-16 h-16 object-contain opacity-60" />
            </div>
          )}
        </div>

        <div data-tauri-drag-region className="relative flex flex-col flex-1 min-w-0 justify-center h-full">
          <div data-tauri-drag-region className="mb-2">
            <p data-tauri-drag-region className="text-white font-black text-base truncate w-full pr-8 drop-shadow-md">{playerTrack ? stripExtension(playerTrack.title) : "No track playing"}</p>
            <p data-tauri-drag-region className="text-[var(--color-neon-yellow)] text-xs font-bold uppercase tracking-widest truncate w-full opacity-80">{playerTrack?.artist || "Muziso"}</p>
          </div>

          <div className="flex items-center gap-4">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handlePrevTrack}
              disabled={!currentTrackPath}
              className="text-white/60 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-all active:scale-90"
            >
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={togglePause}
              disabled={!currentTrackPath}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isBuffering ? 'bg-[var(--color-neon-yellow)]/30 animate-pulse' : 'bg-[var(--color-neon-yellow)] text-black shadow-lg hover:scale-110 active:scale-95'}`}
            >
              {isBuffering ? (
                <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
              ) : isPlaying ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} fill="currentColor" className="ml-1" />
              )}
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleNextTrack}
              disabled={!currentTrackPath}
              className="text-white/60 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-all active:scale-90"
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
          </div>
        </div>

        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggleMiniplayerMode();
          }}
          className="absolute top-3 right-3 text-white/40 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-all z-[100] backdrop-blur-md"
          title="Expand"
        >
          <Maximize2 size={16} />
        </button>
      </div>
    );
  }

  const handleUpdate = async () => {
    const releaseUrl =
      updateInfo?.releaseUrl ||
      (updateInfo?.version
        ? `https://github.com/xtros/Muziso/releases/tag/v${updateInfo.version}`
        : "https://github.com/xtros/Muziso/releases/latest");

    try {
      await openUrl(releaseUrl);
    } catch (e) {
      console.error("Failed to open release page:", e);
      window.open(releaseUrl, "_blank");
    }
  };

  return (
    <div
      className="flex flex-col h-screen w-full text-white overflow-hidden font-sans select-none relative main-container transition-all duration-1000"
      style={{ backgroundColor: dynamicTheme.darkRgb }}
    >
      {/* ── Ambient Song-Color Aura — multi-layer immersive glow ── */}
      {/* Top center bloom */}
      <div
        className="absolute inset-0 z-0 pointer-events-none transition-all duration-1000 ease-out"
        style={{ background: `radial-gradient(ellipse 80% 45% at 50% -5%, rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.38) 0%, transparent 70%)` }}
      />
      {/* Bottom center warm undertone */}
      <div
        className="absolute inset-0 z-0 pointer-events-none transition-all duration-1000 ease-out"
        style={{ background: `radial-gradient(ellipse 70% 35% at 50% 110%, rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.18) 0%, transparent 70%)` }}
      />
      {/* Left sidebar accent halo */}
      <div
        className="absolute inset-0 z-0 pointer-events-none transition-all duration-1000 ease-out"
        style={{ background: `radial-gradient(ellipse 30% 60% at -5% 50%, rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.14) 0%, transparent 70%)` }}
      />
      {/* Top-right corner shimmer */}
      <div
        className="absolute inset-0 z-0 pointer-events-none transition-all duration-1000 ease-out"
        style={{ background: `radial-gradient(ellipse 40% 30% at 105% -5%, rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.12) 0%, transparent 70%)` }}
      />

      {/* Update Toast */}
      <AnimatePresence>
        {updateInfo && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-24 right-8 z-[100] bg-purple-950/90 backdrop-blur-3xl p-5 rounded-2xl border border-purple-500/40 shadow-2xl max-w-sm w-[90vw] md:w-auto"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-purple-500/20 shrink-0">
                <Sparkles className="w-5 h-5 text-purple-300 animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-white leading-tight">
                  App Update Available (v{updateInfo.version})
                </h4>
                <p className="text-xs text-purple-200/80 mt-1 leading-relaxed line-clamp-2">
                  {updateInfo.body || "A new release of Muziso is available!"}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={handleUpdate}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-black bg-purple-500 hover:bg-purple-400 text-white transition-all shadow-md active:scale-95 flex items-center gap-1.5"
                  >
                    <ExternalLink size={14} />
                    View & Download Release
                  </button>
                  <button
                    onClick={() => setUpdateInfo(null)}
                    className="text-neutral-400 hover:text-white text-xs font-medium px-2 py-1"
                  >
                    Later
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stream Error / Preview Toast */}
      <AnimatePresence>
        {streamError && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className={`fixed bottom-24 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:right-8 z-[100] backdrop-blur-3xl p-5 rounded-2xl shadow-2xl max-w-sm w-[90vw] md:w-auto ${streamError.previewUrl
              ? 'bg-amber-950/80 border border-amber-500/30'
              : 'bg-red-950/80 border border-red-500/30'
              }`}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${streamError.previewUrl ? 'bg-amber-500/10' : 'bg-red-500/10'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={streamError.previewUrl ? 'text-amber-400' : 'text-red-400'}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="10" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className={`text-sm font-bold leading-tight ${streamError.previewUrl ? 'text-amber-300' : 'text-red-300'}`}>
                  {streamError.previewUrl ? 'Playing Preview' : 'Track Unavailable'}
                </h4>
                <p className="text-xs text-neutral-400 mt-1 leading-relaxed">{streamError.message}</p>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <button
                    onClick={() => {
                      const q = `${streamError.trackTitle || ''} ${streamError.trackArtist || ''}`.trim();
                      setSearchQuery(q);
                      setActiveTab('browse');
                      setStreamError(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5 ${streamError.previewUrl
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300'
                      : 'bg-red-500/20 hover:bg-red-500/30 text-red-300'
                      }`}
                  >
                    <Search size={12} />
                    Search on YouTube
                  </button>
                  <button
                    onClick={() => setStreamError(null)}
                    className="text-neutral-500 hover:text-white text-xs font-medium px-2 py-1"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <audio ref={silentAudioRef} loop style={{ display: 'none' }} src="data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==" />

      {/* TOP HEADER BAR */}
      <header
        className="h-16 px-5 flex items-center justify-between bg-zinc-950/80 backdrop-blur-2xl z-50 shrink-0 select-none border-b border-white/10 transition-all duration-700"
        style={{ borderBottomColor: `rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.25)` }}
        data-tauri-drag-region
      >
        {/* Navigation Arrows & App Brand */}
        <div className="flex items-center gap-3">
          {/* Muziso Logo */}
          <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setActiveTab('listen')}>
            <img
              src={logoImg}
              alt="Muziso"
              className="h-9 w-auto object-contain drop-shadow-[0_0_12px_rgba(255,255,255,0.4)] group-hover:scale-105 transition-transform duration-200 shrink-0 brightness-120"
              title="Muziso"
            />
          </div>
          <div className="flex items-center gap-1.5 ml-1">
            <button className="w-8 h-8 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/10 flex items-center justify-center transition-all shadow-sm" title="Back">
              <ChevronLeft size={18} />
            </button>
            <button className="w-8 h-8 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/10 flex items-center justify-center transition-all shadow-sm" title="Forward">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* Center Integrated Search Pill & Home Button */}
        <div className="flex items-center gap-2 flex-1 max-w-2xl mx-4">
          <button
            onClick={() => setActiveTab('listen')}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0 border ${activeTab === 'listen' ? 'bg-white text-black border-white shadow-lg shadow-white/20' : 'bg-zinc-900/80 text-zinc-400 border-white/10 hover:bg-zinc-800 hover:text-white'}`}
            title="Home"
          >
            <Home size={19} />
          </button>

          <div className="relative flex-1 flex items-center">
            <div className="absolute left-4 text-zinc-400">
              <Search size={18} />
            </div>
            <input
              type="text"
              value={searchQuery}
              onFocus={() => {
                if (activeTab !== 'browse') setActiveTab('browse');
              }}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (activeTab !== 'browse') setActiveTab('browse');
              }}
              placeholder="Search tracks, artists, YouTube & SoundCloud..."
              className="w-full bg-zinc-900/90 hover:bg-zinc-900 focus:bg-black text-white text-xs md:text-sm font-medium rounded-full py-2.5 pl-11 pr-11 placeholder-zinc-500 border border-white/10 focus:border-white focus:ring-2 focus:ring-white/20 focus:outline-none transition-all shadow-inner"
            />
            <div className="absolute right-4 text-zinc-400 hover:text-white cursor-pointer transition-colors" onClick={handleScanClick} title="Browse Local Music Folder">
              <FolderOpen size={18} />
            </div>
          </div>
        </div>

        {/* Right Notification Bell & User Profile */}
        <div className="flex items-center gap-3 relative">
          <button 
            onClick={() => {
              setShowNotificationsMenu(!showNotificationsMenu);
              setShowProfileMenu(false);
            }}
            className="w-9 h-9 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/10 flex items-center justify-center transition-all shadow-sm relative" 
            title="Notifications"
          >
            <Bell size={18} />
            {hasUnreadNotifications && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 border border-black animate-pulse" />
            )}
          </button>

          <button
            onClick={() => {
              setShowProfileMenu(!showProfileMenu);
              setShowNotificationsMenu(false);
            }}
            className={`w-9 h-9 rounded-full border ${userProfile.avatarUrl ? 'border-white' : 'border-white/15'} flex items-center justify-center font-extrabold text-xs text-white shadow-md hover:scale-105 transition-all overflow-hidden bg-gradient-to-br ${userProfile.avatarGradient || 'from-purple-600 to-emerald-500'}`}
            title={userProfile.name}
          >
            {userProfile.avatarUrl ? (
              <img src={userProfile.avatarUrl} className="w-full h-full object-cover" alt={userProfile.name} />
            ) : (
              getInitials(userProfile.name)
            )}
          </button>

          {/* Notifications Dropdown Menu */}
          <AnimatePresence>
            {showNotificationsMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-12 w-80 bg-[#181818] border border-white/15 rounded-2xl shadow-2xl p-3 z-[100] flex flex-col gap-2 max-h-[400px] overflow-hidden"
              >
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black text-[#ccff00] uppercase tracking-widest">Developer Messages</span>
                    {hasUnreadNotifications && (
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    )}
                  </div>
                  {notifications.length > 0 && hasUnreadNotifications && (
                    <button 
                      onClick={markAllNotificationsAsRead}
                      className="text-[10px] font-bold text-zinc-400 hover:text-white transition-colors"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-zinc-500 text-xs font-medium">
                      No notifications or messages
                    </div>
                  ) : (
                    notifications.map((n) => {
                      const isUnread = !readNotificationIds.includes(String(n.id));
                      return (
                        <div 
                          key={n.id}
                          onClick={() => {
                            if (isUnread) {
                              const updated = [...readNotificationIds, String(n.id)];
                              setReadNotificationIds(updated);
                              try {
                                localStorage.setItem('muziso_read_notifications', JSON.stringify(updated));
                              } catch (e) {
                                console.error(e);
                              }
                              setHasUnreadNotifications(notifications.some(notif => !updated.includes(String(notif.id))));
                            }
                          }}
                          className={`p-3 rounded-xl border transition-all text-left relative flex flex-col gap-1.5 cursor-pointer ${
                            isUnread 
                              ? 'bg-zinc-900/60 border-[#ccff00]/20 hover:bg-zinc-900' 
                              : 'bg-zinc-900/20 border-white/5 hover:bg-zinc-900/40'
                          }`}
                        >
                          {isUnread && (
                            <span className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-[#ccff00]" />
                          )}
                          <div className="flex flex-col gap-0.5 pr-2">
                            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">{n.date}</span>
                            <span className="text-xs font-bold text-white leading-tight">{n.title}</span>
                          </div>
                          <p className="text-[11px] text-zinc-400 leading-normal font-medium">{n.content}</p>
                          {n.actionUrl && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await openUrl(n.actionUrl);
                                } catch (err) {
                                  console.error("Failed to open URL:", err);
                                }
                              }}
                              className="self-start text-[10px] font-black text-[#ccff00] hover:text-[#b5e600] uppercase tracking-wider mt-1 transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              {n.actionLabel || 'Learn More'}
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Profile Dropdown Menu */}
          <AnimatePresence>
            {showProfileMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute right-0 top-12 w-64 bg-[#181818] border border-white/15 rounded-2xl shadow-2xl p-2 z-[100] space-y-1"
              >
                <div className="p-3 border-b border-white/10 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-xs text-white bg-gradient-to-br ${userProfile.avatarGradient || 'from-purple-600 to-emerald-500'} overflow-hidden shrink-0`}>
                    {userProfile.avatarUrl ? <img src={userProfile.avatarUrl} className="w-full h-full object-cover" alt={userProfile.name} /> : getInitials(userProfile.name)}
                  </div>
                  <div className="truncate min-w-0">
                    <p className="font-extrabold text-sm text-white truncate">{userProfile.name}</p>
                    <p className="text-xs text-neutral-400 truncate">Free Member</p>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setEditName(userProfile.name);
                    setEditEmail(userProfile.email || '');
                    setEditAvatarUrl(userProfile.avatarUrl || '');
                    setEditGradient(userProfile.avatarGradient || 'from-purple-600 to-emerald-500');
                    setShowProfileMenu(false);
                    setShowProfileModal(true);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-white/10 text-xs font-bold text-white flex items-center gap-2 transition-all"
                >
                  <Settings size={16} className="text-neutral-400" />
                  <span>Edit Profile & Name</span>
                </button>

                <button
                  onClick={() => {
                    setShowProfileMenu(false);
                    setActiveTab('settings');
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-white/10 text-xs font-bold text-white flex items-center gap-2 transition-all"
                >
                  <Crown size={16} className="text-amber-400" />
                  <span>Account & Settings</span>
                </button>

                <button
                  onClick={() => {
                    const loggedOut = { name: 'Guest Listener', email: '', isLoggedIn: false, avatarGradient: 'from-zinc-700 to-zinc-900' };
                    saveProfile(loggedOut);
                    setShowProfileMenu(false);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-red-500/20 text-xs font-bold text-red-400 flex items-center gap-2 transition-all"
                >
                  <X size={16} />
                  <span>{userProfile.isLoggedIn ? 'Sign Out' : 'Reset Profile'}</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* MAIN BODY */}
      <div className="flex-1 flex gap-3 px-3 pb-3 overflow-hidden min-h-0 z-10">

        {/* LEFT SLIM SIDEBAR */}
        <aside
          className="w-16 md:w-64 rounded-2xl p-3 flex flex-col justify-between shrink-0 overflow-hidden transition-all duration-700 border border-white/10 bg-zinc-950/80 backdrop-blur-2xl shadow-xl"
          style={{ background: dynamicTheme.panelBackground }}
        >
          {/* Top section: Library header & scrollable user playlists */}
          <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between px-2 pt-1 shrink-0">
              <button onClick={() => setActiveTab('library')} className="flex items-center gap-3 text-zinc-300 hover:text-white font-bold text-sm transition-colors">
                <Library size={22} className="text-white" />
                <span className="hidden md:inline font-extrabold tracking-tight">Your Library</span>
              </button>
              <button
                onClick={async () => {
                  const name = await showPrompt("Enter new playlist name:");
                  if (name && name.trim()) {
                    const pl = createPlaylist(name);
                    if (pl) {
                      setSelectedPlaylistId(pl.id);
                      setActiveTab('playlist');
                    }
                  }
                }}
                className="text-zinc-400 hover:text-white p-1.5 hover:bg-zinc-800 rounded-xl transition-all border border-transparent hover:border-white/10"
                title="Create New Playlist"
              >
                <Plus size={18} />
              </button>
            </div>

            {/* Scrollable list of user playlists & library items */}
            <div className="flex-1 overflow-y-auto no-scrollbar space-y-1 pr-0.5 pt-1">
              {/* Liked Songs Shortcut */}
              <button
                onClick={() => setActiveTab('liked')}
                className={`w-full flex items-center gap-3 p-2 rounded-xl transition-all group ${
                  activeTab === 'liked'
                    ? 'bg-white/15 border border-white/30 text-white font-bold shadow-md'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                title="Liked Songs"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-900 border border-white/10 flex items-center justify-center shrink-0 shadow-md group-hover:scale-105 transition-transform">
                  <Heart size={18} fill="white" className="text-white" />
                </div>
                <div className="hidden md:flex flex-col text-left truncate min-w-0 flex-1">
                  <span className="text-xs font-bold truncate text-white">Liked Songs</span>
                  <span className="text-[10px] text-zinc-400 truncate">Playlist • {likedTracks.length} songs</span>
                </div>
              </button>

              {/* Local Music Directory Shortcut */}
              <button
                onClick={() => setActiveTab('library')}
                className={`w-full flex items-center gap-3 p-2 rounded-xl transition-all group ${
                  activeTab === 'library'
                    ? 'bg-white/15 border border-white/30 text-white font-bold shadow-md'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                title="Local Library"
              >
                <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-white/10 flex items-center justify-center shrink-0 shadow-md group-hover:scale-105 transition-transform">
                  <FolderOpen size={18} className="text-zinc-300" />
                </div>
                <div className="hidden md:flex flex-col text-left truncate min-w-0 flex-1">
                  <span className="text-xs font-bold truncate text-white">Local Library</span>
                  <span className="text-[10px] text-zinc-400 truncate">Folder • {tracks.length} songs</span>
                </div>
              </button>

              {/* Divider */}
              <div className="h-px bg-white/10 my-2 mx-1 hidden md:block" />

              {/* User Created Playlists */}
              {playlists.map((pl) => {
                const isSelected = activeTab === 'playlist' && selectedPlaylistId === pl.id;
                return (
                  <div
                    key={pl.id}
                    onClick={() => {
                      setSelectedPlaylistId(pl.id);
                      setActiveTab('playlist');
                    }}
                    className={`w-full flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-all group ${
                      isSelected
                        ? 'bg-white/15 border border-white/30 text-white'
                        : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
                    }`}
                    title={pl.name}
                  >
                    <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-white/10 overflow-hidden flex items-center justify-center shrink-0 shadow-md group-hover:scale-105 transition-transform">
                      {pl.artwork_url ? (
                        <img src={pl.artwork_url} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <ListMusic size={18} className="text-zinc-400" />
                      )}
                    </div>
                    <div className="hidden md:flex flex-col text-left truncate min-w-0 flex-1">
                      <span className={`text-xs truncate ${isSelected ? 'font-black text-white' : 'font-semibold text-zinc-200 group-hover:text-white'}`}>{pl.name}</span>
                      <span className="text-[10px] text-zinc-400 truncate">Playlist • {pl.tracks?.length || 0} songs</span>
                    </div>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        const confirmed = await showConfirm(`Delete playlist "${pl.name}"?`, 'Muziso');
                        if (confirmed) {
                          deletePlaylist(pl.id);
                        }
                      }}
                      className="hidden md:group-hover:flex items-center justify-center p-1 hover:text-red-400 transition-colors text-zinc-500"
                      title="Delete Playlist"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}

              {/* Empty state shortcut if no user playlists exist */}
              {playlists.length === 0 && (
                <div
                  onClick={async () => {
                    const name = await showPrompt("Enter new playlist name:");
                    if (name && name.trim()) {
                      const pl = createPlaylist(name);
                      if (pl) {
                        setSelectedPlaylistId(pl.id);
                        setActiveTab('playlist');
                      }
                    }
                  }}
                  className="hidden md:flex items-center gap-2 p-2.5 rounded-xl border border-dashed border-white/10 hover:border-white/30 text-zinc-400 hover:text-white cursor-pointer transition-all text-xs font-semibold mt-2"
                >
                  <Plus size={14} />
                  <span>Create Playlist</span>
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-white/10 flex flex-col gap-1 shrink-0">
            <NavItem icon={<User size={19} className={userProfile.isLoggedIn ? "text-white" : "text-zinc-400"} />} label={userProfile.isLoggedIn ? (userProfile.name.split(' ')[0] || "Account") : "Sign In"} active={activeTab === 'account'} onClick={() => setActiveTab('account')} hideLabelOnMobile />
            <NavItem icon={<Crown size={19} className="text-amber-400" />} label="Muziso PRO" active={activeTab === 'premium'} onClick={() => setActiveTab('premium')} hideLabelOnMobile />
            <NavItem icon={<Settings size={19} />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} hideLabelOnMobile />
          </div>
        </aside>

        {/* CENTER MAIN CONTENT AREA */}
        <main
          ref={mainScrollRef}
          className="flex-1 rounded-2xl p-6 overflow-y-auto no-scrollbar scroll-smooth transition-all duration-700 border border-white/10 bg-zinc-950/60 backdrop-blur-xl shadow-2xl"
          style={{ background: dynamicTheme.headerGradient }}
        >
          <AnimatePresence mode="wait">
            {activeTab === 'listen' ? (
              <motion.div key="listen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">

                {/* Section 1: Jump back in */}
                <div className="space-y-4 pt-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-black text-white tracking-tight">Jump back in</h2>
                  </div>

                  {recentlyPlayed.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {recentlyPlayed.slice(0, 6).map((track, i) => {
                        const isCurrentTrack = (playerTrack?.id || currentTrackPath) === (track.id || track.filepath);
                        const isThisPlaying = isPlaying && isCurrentTrack;
                        return (
                          <motion.div
                            key={(track.id || track.title) + i}
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => (!track.source || track.source === 'local') ? handlePlayLocalTrack(track.filepath || track.id) : handleStreamExternalAudio(track, 'recent')}
                            onContextMenu={(e) => openContextMenu(e, track)}
                            className={`group flex items-center gap-3 rounded-xl overflow-hidden cursor-pointer transition-all duration-200
                              ${isCurrentTrack
                                ? 'bg-white/10 border border-white/40 shadow-[0_0_20px_rgba(255,255,255,0.2)]'
                                : 'bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20'}`}
                          >
                            {/* Square artwork */}
                            <div className="relative w-14 h-14 shrink-0 bg-zinc-900 overflow-hidden">
                              <img
                                src={track.artwork_url || `https://picsum.photos/seed/${encodeURIComponent(track.title)}/200`}
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                alt={track.title}
                              />
                              {/* Play overlay */}
                              <div className={`absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity duration-200
                                ${isThisPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                <div className="w-7 h-7 rounded-full flex items-center justify-center shadow-lg bg-white text-black">
                                  {isThisPlaying
                                    ? <Pause size={13} fill="black" className="text-black" />
                                    : <Play size={13} fill="black" className="text-black ml-0.5" />}
                                </div>
                              </div>
                            </div>
                            {/* Title + artist */}
                            <div className="flex-1 min-w-0 pr-3">
                              <p className={`text-sm font-bold truncate leading-tight ${isCurrentTrack ? 'text-white font-black' : 'text-zinc-200'}`}>
                                {stripExtension(track.title)}
                              </p>
                              {track.artist && (
                                <p className="text-xs text-zinc-400 truncate mt-0.5">{track.artist}</p>
                              )}
                            </div>
                            {/* Active equalizer bars */}
                            {isThisPlaying && (
                              <div className="flex items-end gap-0.5 pr-3 shrink-0">
                                <span className="w-0.5 h-2 rounded-full bg-white eq-bar-1" />
                                <span className="w-0.5 h-3 rounded-full bg-zinc-300 eq-bar-2" />
                                <span className="w-0.5 h-1.5 rounded-full bg-white eq-bar-3" />
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </div>



                {/* Section: Recommended Playlists */}
                {trendingPlaylists.length > 0 && (
                  <div className="space-y-4 pt-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
                        <Disc size={22} className="text-white animate-spin-slow" />
                        Recommended Playlists
                      </h2>
                      <span onClick={() => setActiveTab('browse')} className="text-xs text-zinc-300 hover:text-white hover:underline cursor-pointer font-bold">See All</span>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                      {trendingPlaylists.slice(0, 6).map((playlist, idx) => (
                        <AlbumCard
                          key={playlist.id + idx}
                          index={idx}
                          title={playlist.title}
                          artist={playlist.subtitle}
                          artworkUrl={playlist.artwork_url}
                          onClick={() => handleOpenExternalPlaylist(playlist)}
                          isPlaying={isPlaying && selectedExternalPlaylist?.id === playlist.id}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Section: Recommended Songs */}
                {trendingNews.length > 0 && (
                  <div className="space-y-4 pt-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
                        <Compass size={22} className="text-white" />
                        Recommended Songs
                      </h2>
                      <p className="text-xs text-zinc-400 font-medium">Fresh hits tailored to your languages</p>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {trendingNews.slice(0, 6).map((track, i) => {
                        const transformedTrack = {
                          ...track,
                          id: `saavn-${track.title}-${track.artist}`,
                          title: track.title,
                          artist: track.artist,
                          artwork_url: track.artwork_url,
                          source: 'spotify' as const,
                          album: track.release_date || '',
                          duration_ms: 0
                        };
                        return (
                          <TrackResult
                            key={transformedTrack.id + '-' + i}
                            track={transformedTrack}
                            onPlay={() => handleStreamExternalAudio(transformedTrack, 'external-playlist')}
                            currentTrackId={playerTrack?.id || currentTrackPath}
                            isCurrentlyPlaying={isPlaying}
                            onContextMenu={(e) => openContextMenu(e, transformedTrack)}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

              </motion.div>
            ) : activeTab === 'library' ? (
              <motion.div key="library" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                  <h1 className="text-4xl font-black text-white tracking-tight">Your Library</h1>
                  <div className="flex items-center gap-3">
                    <ViewToggle viewMode={viewMode} onChange={setViewMode} />
                    <div className="relative">
                      <button
                        onClick={() => setShowAddMenu(!showAddMenu)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-zinc-200 text-black font-extrabold rounded-full text-sm transition-all shadow-lg shadow-white/10 hover:scale-105 active:scale-95"
                      >
                        <Plus size={16} />
                        <span>Add</span>
                      </button>

                      <AnimatePresence>
                        {showAddMenu && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
                            <motion.div
                              initial={{ opacity: 0, y: -10, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -10, scale: 0.95 }}
                              className="absolute right-0 top-12 w-56 bg-[#282828] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 flex flex-col py-1"
                            >
                              <button
                                onClick={async () => {
                                  setShowAddMenu(false);
                                  const name = await showPrompt("Enter playlist name:");
                                  if (name && name.trim()) {
                                    const pl = createPlaylist(name);
                                    if (pl) {
                                      setSelectedPlaylistId(pl.id);
                                      setActiveTab('playlist');
                                    }
                                  }
                                }}
                                className="flex items-center gap-3 px-4 py-3 text-sm text-[#b3b3b3] hover:text-white hover:bg-white/10 transition-colors text-left"
                              >
                                <ListMusic size={16} />
                                <span className="font-bold">Create a playlist</span>
                              </button>
                              
                              <div className="h-px bg-white/10 mx-2 my-1" />
                              
                              <button
                                onClick={() => {
                                  setShowAddMenu(false);
                                  handleScanClick();
                                }}
                                disabled={isScanning}
                                className="flex items-center gap-3 px-4 py-3 text-sm text-[#b3b3b3] hover:text-white hover:bg-white/10 transition-colors text-left disabled:opacity-50"
                              >
                                <FolderOpen size={16} />
                                <span className="font-bold">{isScanning ? "Scanning..." : "Add Music Folder Locally"}</span>
                              </button>
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                <div className="mb-10 space-y-4">
                  <h2 className="text-xl font-bold text-white">Playlists</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {/* Liked Songs Square Card */}
                    <motion.div
                      whileHover={{ y: -6, scale: 1.01 }}
                      onClick={() => setActiveTab('liked')}
                      className="group cursor-pointer flex flex-col gap-3 p-3 rounded-2xl bg-transparent hover:bg-white/10 border border-transparent transition-all duration-300 relative"
                    >
                      <div className="aspect-square rounded-xl bg-gradient-to-br from-indigo-600 via-purple-600 to-violet-500 flex items-center justify-center border border-white/5 shadow-md relative overflow-hidden">
                        <Heart size={40} fill="white" className="text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.3)]" />
                        
                        {/* Hover play overlay */}
                        <div className="absolute inset-0 bg-black/40 transition-all duration-300 flex items-center justify-center backdrop-blur-[2px] opacity-0 group-hover:opacity-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (likedTracks.length > 0) {
                                handleStreamExternalAudio(likedTracks[0], 'liked');
                              }
                            }}
                            className="w-12 h-12 bg-[#ccff00] shadow-[0_0_20px_rgba(204,255,0,0.5)] rounded-full flex items-center justify-center border border-white/20 hover:scale-105 active:scale-95 transition-all"
                          >
                            <Play size={18} fill="black" className="text-black ml-0.5" />
                          </button>
                        </div>
                      </div>
                      <div className="px-0.5 min-w-0">
                        <h3 className="font-extrabold text-sm text-white truncate group-hover:text-[#ccff00] transition-colors">Liked Songs</h3>
                        <p className="text-xs text-neutral-400 mt-0.5 truncate font-semibold">Playlist • {userProfile.name ? userProfile.name.split(' ')[0] : 'JTS'}</p>
                      </div>
                    </motion.div>

                    {/* Custom Playlists */}
                    {playlists.map((pl) => {
                      const isThisPlaying = isPlaying && externalTrack?.playbackContext === `playlist-${pl.id}`;
                      return (
                        <PlaylistCard
                          key={pl.id}
                          playlist={pl}
                          username={userProfile.name ? userProfile.name.split(' ')[0] : 'JTS'}
                          onClick={() => {
                            setSelectedPlaylistId(pl.id);
                            setActiveTab('playlist');
                          }}
                          onPlayPlaylist={() => {
                            if (pl.tracks.length > 0) {
                              handleStreamExternalAudio(pl.tracks[0], `playlist-${pl.id}` as any);
                            }
                          }}
                          onDeletePlaylist={async () => {
                            const confirmed = await showConfirm(`Delete playlist "${pl.name}"?`, 'Muziso');
                            if (confirmed) {
                              deletePlaylist(pl.id);
                            }
                          }}
                          isPlayingPlaylist={isThisPlaying}
                        />
                      );
                    })}
                  </div>
                </div>
                
                {tracks.length > 0 && (
                  <div className="mb-4">
                    <h2 className="text-xl font-bold text-white">Local Tracks</h2>
                  </div>
                )}

                {tracks.length === 0 ? null : viewMode === 'grid' ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {tracks.map((track, i) => (
                      <AlbumCard
                        key={track.filepath}
                        index={i}
                        title={track.title}
                        artist={track.artist}
                        artworkUrl={track.artwork_url}
                        onClick={() => (!track.source || track.source === 'local') ? handlePlayLocalTrack(track.filepath) : handleStreamExternalAudio(track)}
                        isPlaying={currentTrackPath === track.filepath && isPlaying}
                        onContextMenu={(e) => openContextMenu(e, track)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {tracks.map((track) => (
                      <TrackResult
                        key={track.filepath}
                        track={{
                          id: track.id || track.filepath,
                          title: track.title,
                          artist: track.artist,
                          album: track.album,
                          duration_ms: track.duration_ms,
                          artwork_url: track.artwork_url || `https://picsum.photos/seed/${track.title}/200`,
                          source: track.source || 'local',
                          stream_url: track.filepath
                        }}
                        onPlay={() => (!track.source || track.source === 'local') ? handlePlayLocalTrack(track.filepath) : handleStreamExternalAudio(track)}
                        currentTrackId={currentTrackPath}
                        isCurrentlyPlaying={isPlaying && currentTrackPath === track.filepath}
                        onContextMenu={(e) => openContextMenu(e, track)}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            ) : activeTab === 'liked' ? (
              <motion.div key="liked" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="flex items-center justify-between mb-8">
                  <h1 className="text-4xl font-black text-white tracking-tight">Liked Songs</h1>
                  <ViewToggle viewMode={viewMode} onChange={setViewMode} />
                </div>
                {likedTracks.length === 0 ? (
                  <div className="py-20 text-center text-neutral-500">
                    <Heart size={48} className="mx-auto mb-4 opacity-50" />
                    <p className="font-medium">You haven't liked any songs yet.</p>
                  </div>
                ) : viewMode === 'grid' ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {likedTracks.map((track, i) => (
                      <AlbumCard
                        key={track.id + i}
                        index={i}
                        title={track.title}
                        artist={track.artist}
                        artworkUrl={track.artwork_url}
                        source={track.source}
                        onClick={() => handleStreamExternalAudio(track, 'liked')}
                        isPlaying={(playerTrack?.id || currentTrackPath) === track.id && isPlaying}
                        onContextMenu={(e) => openContextMenu(e, track)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {likedTracks.map((track, i) => (
                      <TrackResult key={track.id + i} track={track as any} onPlay={() => handleStreamExternalAudio(track, 'liked')} currentTrackId={playerTrack?.id || currentTrackPath} isCurrentlyPlaying={isPlaying} onContextMenu={(e) => openContextMenu(e, track)} />
                    ))}
                  </div>
                )}
              </motion.div>
            ) : activeTab === 'playlists_list' ? (
              <motion.div key="playlists_list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => setActiveTab('library')}
                      className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white transition-all"
                    >
                      <ArrowLeft size={20} />
                    </button>
                    <h1 className="text-4xl font-black text-white tracking-tight">Playlists</h1>
                  </div>
                  <button
                    onClick={async () => {
                      const name = await showPrompt("Enter playlist name:");
                      if (name && name.trim()) {
                        createPlaylist(name);
                      }
                    }}
                    className="px-5 py-2.5 rounded-2xl bg-[#ccff00] hover:bg-[#b5e600] text-black font-extrabold text-xs transition-all shadow-md flex items-center gap-2 active:scale-95"
                  >
                    <Plus size={16} />
                    Create Playlist
                  </button>
                </div>

                {playlists.length === 0 ? (
                  <div className="py-20 text-center text-neutral-500 bg-white/5 rounded-3xl border border-white/5">
                    <ListMusic size={64} className="mx-auto mb-4 opacity-30" />
                    <p className="font-semibold text-base text-white">Create your first custom playlist</p>
                    <p className="text-xs text-neutral-400 mt-1">Right-click any song to add it to a playlist!</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                    {playlists.map((pl) => (
                      <div
                        key={pl.id}
                        onClick={() => {
                          setSelectedPlaylistId(pl.id);
                          setActiveTab('playlist');
                        }}
                        className="glass-panel p-4 rounded-3xl cursor-pointer hover:bg-white/5 transition-all duration-300 border border-white/5 hover:border-white/20 group relative"
                      >
                        <div className="aspect-square w-full rounded-2xl overflow-hidden bg-neutral-800 mb-3 shadow-lg relative">
                          {pl.artwork_url ? (
                            <img src={pl.artwork_url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                              <ListMusic size={32} className="text-neutral-500" />
                            </div>
                          )}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const confirmed = await showConfirm(`Delete playlist "${pl.name}"?`, 'Muziso');
                              if (confirmed) {
                                deletePlaylist(pl.id);
                              }
                            }}
                            className="absolute top-2 right-2 p-2 rounded-full bg-black/60 hover:bg-red-600/90 text-white opacity-0 group-hover:opacity-100 transition-all shadow-md"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <h3 className="font-bold text-sm text-white truncate">{pl.name}</h3>
                        <p className="text-xs text-neutral-400 truncate mt-1">{pl.tracks.length} songs</p>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (activeTab === 'playlist' && selectedPlaylistId) ? (() => {
              const pl = playlists.find(p => p.id === selectedPlaylistId);
              if (!pl) return <div className="text-white">Playlist not found.</div>;
              return (
                <motion.div key="playlist_detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
                  {/* Header Banner */}
                  <div className="flex flex-col md:flex-row gap-6 items-end">
                    <button
                      onClick={() => setActiveTab('library')}
                      className="md:hidden p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white transition-all self-start"
                    >
                      <ArrowLeft size={20} />
                    </button>

                    <div className="w-48 h-48 rounded-3xl overflow-hidden bg-neutral-800 shadow-2xl border border-white/10 shrink-0">
                      {pl.artwork_url ? (
                        <img src={pl.artwork_url} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                          <ListMusic size={64} className="text-neutral-500" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="hidden md:flex items-center gap-2">
                        <button
                          onClick={() => setActiveTab('library')}
                          className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white transition-all"
                        >
                          <ArrowLeft size={16} />
                        </button>
                        <span className="text-xs font-black text-[#ccff00] uppercase tracking-widest">Playlist</span>
                      </div>
                      <div className="flex items-center gap-3 group">
                        <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter leading-none truncate">
                          {pl.name}
                        </h1>
                        <button
                          onClick={async () => {
                            const newName = await showPrompt("Rename playlist to:", pl.name);
                            if (newName && newName.trim() && newName.trim() !== pl.name) {
                              setPlaylists(prev => prev.map(p => p.id === pl.id ? { ...p, name: newName.trim() } : p));
                            }
                          }}
                          className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Edit3 size={14} />
                        </button>
                      </div>
                      <p className="text-sm text-neutral-400 font-medium">
                        Custom Playlist • {pl.tracks.length} songs
                      </p>

                      <div className="flex items-center gap-3 pt-2">
                        {pl.tracks.length > 0 && (
                          <button
                            onClick={() => {
                              const firstTrack = pl.tracks[0];
                              handleStreamExternalAudio(firstTrack, `playlist-${pl.id}` as any);
                            }}
                            className="px-6 py-3 rounded-full bg-[#ccff00] hover:bg-[#b5e600] text-black font-extrabold text-sm transition-all shadow-lg flex items-center gap-2 hover:scale-105 active:scale-95"
                          >
                            <Play size={16} fill="black" />
                            Play Playlist
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            const confirmed = await showConfirm(`Are you sure you want to delete "${pl.name}"?`, 'Muziso');
                            if (confirmed) {
                              deletePlaylist(pl.id);
                            }
                          }}
                          className="px-5 py-3 rounded-full bg-white/5 hover:bg-red-600/20 hover:text-red-400 text-neutral-400 font-bold text-sm transition-all border border-white/5 hover:border-red-600/30 flex items-center gap-2"
                        >
                          <Trash2 size={14} />
                          Delete Playlist
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Songs list */}
                  <div className="space-y-4">
                    <h2 className="text-xl font-bold text-white">Songs</h2>
                    {pl.tracks.length === 0 ? (
                      <div className="py-12 text-center text-neutral-500 bg-white/5 rounded-2xl border border-white/5">
                        <p className="font-semibold">This playlist is empty.</p>
                        <p className="text-xs text-neutral-400 mt-1">Right-click any song in Search, Browse or Library and click "Add to Playlist"!</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {pl.tracks.map((track: any, i: number) => (
                          <div key={(track.id || track.filepath) + '-' + i} className="flex items-center gap-2 group">
                            <div className="flex-1 min-w-0">
                              <TrackResult
                                track={track}
                                onPlay={() => handleStreamExternalAudio(track, `playlist-${pl.id}` as any)}
                                currentTrackId={playerTrack?.id || currentTrackPath}
                                isCurrentlyPlaying={isPlaying}
                                onContextMenu={(e) => openContextMenu(e, track, pl.id)}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })()
            : (activeTab === 'external_playlist' && selectedExternalPlaylist) ? (
              <motion.div key="external_playlist_detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
                {/* Header Banner */}
                <div className="flex flex-col md:flex-row gap-6 items-end">
                  <button
                    onClick={() => setActiveTab(prevTab)}
                    className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white transition-all self-start"
                  >
                    <ArrowLeft size={20} />
                  </button>

                  <div className="w-48 h-48 rounded-3xl overflow-hidden bg-neutral-800 shadow-2xl border border-white/10 shrink-0">
                    {selectedExternalPlaylist.artwork_url ? (
                      <img src={selectedExternalPlaylist.artwork_url} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                        <ListMusic size={64} className="text-neutral-500" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    <span className="text-xs font-black text-[#ccff00] uppercase tracking-widest">
                      {selectedExternalPlaylist.type === 'album' ? 'Album' : 'Trending Playlist'}
                    </span>
                    <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter leading-none truncate">
                      {selectedExternalPlaylist.title}
                    </h1>
                    <p className="text-sm text-neutral-400 font-medium">
                      {selectedExternalPlaylist.subtitle} • {externalPlaylistTracks.length} songs
                    </p>

                    <div className="flex items-center gap-3 pt-2">
                      {externalPlaylistTracks.length > 0 && (
                        <button
                          onClick={() => {
                            const firstTrack = externalPlaylistTracks[0];
                            handleStreamExternalAudio(firstTrack, 'external-playlist');
                          }}
                          className="px-6 py-3 rounded-full bg-[#ccff00] hover:bg-[#b5e600] text-black font-extrabold text-sm transition-all shadow-lg flex items-center gap-2 hover:scale-105 active:scale-95"
                        >
                          <Play size={16} fill="black" />
                          Play Playlist
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Songs list */}
                <div className="space-y-4">
                  <h2 className="text-xl font-bold text-white">Songs</h2>
                  {externalPlaylistLoading ? (
                    <div className="flex flex-col gap-3">
                      {[1, 2, 3, 4, 5].map(i => <SkeletonTrack key={i} />)}
                    </div>
                  ) : externalPlaylistTracks.length === 0 ? (
                    <div className="py-12 text-center text-neutral-500 bg-white/5 rounded-2xl border border-white/5">
                      <p className="font-semibold">No songs found in this playlist.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {externalPlaylistTracks.map((track, i) => (
                        <TrackResult
                          key={(track.id || track.filepath) + '-' + i}
                          track={track}
                          onPlay={() => handleStreamExternalAudio(track, 'external-playlist')}
                          currentTrackId={playerTrack?.id || currentTrackPath}
                          isCurrentlyPlaying={isPlaying}
                          onContextMenu={(e) => openContextMenu(e, track)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )
            : activeTab === 'browse' ? (
              <motion.div key="browse" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
                {!searchQuery && (
                  <MusicNews
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    likedTracks={likedTracks}
                    userProfile={userProfile}
                    news={trendingNews}
                    playlists={trendingPlaylists}
                    loading={trendingNewsLoading}
                    onSelect={(track) => {
                      const playTrackObj = {
                        id: track.url || `sp-${track.title} ${track.artist}`,
                        title: track.title,
                        artist: track.artist,
                        artwork_url: track.artwork_url,
                        source: 'spotify'
                      };
                      handleStreamExternalAudio(playTrackObj, 'search');
                    }}
                    onStreamTrack={(track) => {
                      handleStreamExternalAudio(track as any, 'search');
                    }}
                    onPlayPlaylist={handleOpenExternalPlaylist}
                  />
                )}

                {searchQuery && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-black text-white tracking-tight">Search Results</h2>
                    </div>
                    {isSearching ? (
                      <div className="flex flex-col gap-3">
                        {[1, 2, 3, 4, 5, 6].map(i => <SkeletonTrack key={i} />)}
                      </div>
                    ) : searchResults.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {searchResults.map(track => (
                          <TrackResult key={track.id} track={track} onPlay={(track) => {
                            const url = track.stream_url || (
                              track.source === 'youtube' ? `https://www.youtube.com/watch?v=${track.id.replace('yt-', '')}` :
                                track.source === 'soundcloud' ? `https://api-v2.soundcloud.com/tracks/${track.id.replace('sc-', '')}` :
                                  track.id
                            );
                            const streamUrl = track.stream_url || url;
                            handleStreamExternalAudio({
                              id: track.id,
                              source: track.source,
                              filepath: track.id,
                              title: track.title,
                              artist: track.artist,
                              album: track.album || track.source,
                              duration_ms: track.duration_ms,
                              artwork_url: track.artwork_url,
                              stream_url: streamUrl
                            }, 'search');
                            setCoverArt(track.artwork_url);
                          }} currentTrackId={playerTrack?.id || currentTrackPath} isCurrentlyPlaying={isPlaying} onContextMenu={(e) => openContextMenu(e, track)} />
                        ))}
                      </div>
                    ) : (
                      <div className="py-20 text-center text-neutral-500">
                        <p>No results found for "{searchQuery}"</p>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            ) : activeTab === 'account' ? (
              <motion.div key="account" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} className="max-w-4xl mx-auto space-y-8 pb-32">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-4xl font-black text-white tracking-tight">
                      {userProfile.isLoggedIn ? "Account Profile" : "Sign In to Muziso"}
                    </h1>
                    <p className="text-sm text-neutral-400 mt-1 font-medium">
                      {userProfile.isLoggedIn ? "Manage your profile, avatar, and listening statistics" : "Create or log into your account to unlock personalized recommendations & sync"}
                    </p>
                  </div>
                </div>

                {!userProfile.isLoggedIn ? (
                  /* SIGN IN / LOGIN FORM */
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Left Login Card */}
                    <div className="glass-panel p-8 rounded-3xl border border-white/15 bg-gradient-to-b from-[#1c1c1c] to-[#121212] space-y-6 shadow-2xl">
                      <div className="flex items-center gap-3">
                        <div className="p-3 rounded-2xl bg-[#1db954]/20 text-[#1db954]">
                          <LogIn size={24} />
                        </div>
                        <div>
                          <h3 className="text-xl font-extrabold text-white">Listener Login</h3>
                          <p className="text-xs text-neutral-400">Enter your name to start listening</p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest block mb-1.5">Your Display Name</label>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="e.g. Alex Johnson"
                            className="w-full bg-[#181818] border border-white/10 focus:border-[#1db954] rounded-2xl px-4 py-3.5 text-sm text-white focus:outline-none transition-all"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest block mb-1.5">Choose Avatar Theme</label>
                          <div className="flex items-center gap-3 pt-1">
                            {AVATAR_GRADIENTS.map((g) => (
                              <button
                                key={g.label}
                                onClick={() => setEditGradient(g.class)}
                                className={`w-8 h-8 rounded-full bg-gradient-to-br ${g.class} border transition-all ${editGradient === g.class ? 'scale-125 border-white shadow-lg' : 'border-transparent opacity-60 hover:opacity-100'}`}
                                title={g.label}
                              />
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="pt-2">
                        <button
                          onClick={() => {
                            const newProf = {
                              name: editName.trim() || 'Listener',
                              email: editEmail.trim() || 'listener@muziso.app',
                              avatarGradient: editGradient,
                              isLoggedIn: true
                            };
                            saveProfile(newProf);
                          }}
                          className="w-full py-4 rounded-2xl bg-[#1db954] hover:bg-[#1ed760] text-black font-black text-sm transition-all shadow-lg hover:scale-102 active:scale-98 flex items-center justify-center gap-2"
                        >
                          <LogIn size={18} />
                          <span>Sign In & Continue</span>
                        </button>
                      </div>
                    </div>

                    {/* Right Perks Highlight */}
                    <div className="glass-panel p-8 rounded-3xl border border-white/10 bg-gradient-to-br from-[#181818] via-[#141414] to-emerald-950/30 flex flex-col justify-between space-y-6">
                      <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-400 text-xs font-bold uppercase tracking-widest mb-4">
                          <ShieldCheck size={14} /> FREE FOREVER BENEFIT
                        </div>
                        <h3 className="text-2xl font-black text-white tracking-tight mb-4">Why Sign In?</h3>
                        <ul className="space-y-4 text-sm text-slate-300">
                          <li className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0"><Check size={16} /></div>
                            <span>Personalized <strong>Jump Back In</strong> history & stats</span>
                          </li>
                          <li className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 shrink-0"><Wand2 size={16} /></div>
                            <span>AI Neural Taste Engine tailored to your name</span>
                          </li>
                          <li className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 shrink-0"><Heart size={16} /></div>
                            <span>Saved Liked Songs & custom playlists</span>
                          </li>
                          <li className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 shrink-0"><Globe size={16} /></div>
                            <span>Multi-source YouTube, SoundCloud & Spotify access</span>
                          </li>
                        </ul>
                      </div>

                      <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-xs text-neutral-400">
                        100% Free • No passwords required • Local secure persistence
                      </div>
                    </div>
                  </div>
                ) : (
                  /* LOGGED IN ACCOUNT DASHBOARD */
                  <div className="space-y-8">
                    {/* User Banner */}
                    <div className="glass-panel p-8 rounded-3xl border border-white/15 bg-gradient-to-r from-purple-900/30 via-[#181818] to-emerald-900/30 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl">
                      <div className="flex items-center gap-5">
                        <div className={`w-20 h-20 rounded-full border-2 ${userProfile.avatarUrl ? 'border-white' : 'border-white/20'} flex items-center justify-center font-black text-2xl text-white shadow-2xl bg-gradient-to-br ${userProfile.avatarGradient || 'from-purple-600 to-emerald-500'} overflow-hidden shrink-0`}>
                          {userProfile.avatarUrl ? (
                            <img src={userProfile.avatarUrl} className="w-full h-full object-cover" alt={userProfile.name} />
                          ) : (
                            getInitials(userProfile.name)
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-3">
                            <h2 className="text-2xl font-black text-white">{userProfile.name}</h2>
                            <span className="px-3 py-1 rounded-full bg-[#1db954]/20 border border-[#1db954]/40 text-[#1db954] text-xs font-black uppercase tracking-widest">Active Member</span>
                          </div>
                          <p className="text-sm text-neutral-400 mt-1">Free Lifetime Listener</p>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          const loggedOut = { name: 'Guest Listener', email: '', isLoggedIn: false, avatarGradient: 'from-zinc-700 to-zinc-900' };
                          saveProfile(loggedOut);
                        }}
                        className="px-6 py-3 rounded-2xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 font-bold text-xs transition-all flex items-center gap-2 self-start md:self-auto"
                      >
                        <LogOut size={16} />
                        <span>Sign Out</span>
                      </button>
                    </div>

                    {/* Stats Dashboard */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="glass-panel p-6 rounded-3xl border border-white/10 bg-[#151515] flex items-center gap-4">
                        <div className="p-3 rounded-2xl bg-purple-500/10 text-purple-400">
                          <History size={24} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Jump Back In</p>
                          <p className="text-2xl font-black text-white mt-0.5">{recentlyPlayed.length} Songs Saved</p>
                        </div>
                      </div>

                      <div className="glass-panel p-6 rounded-3xl border border-white/10 bg-[#151515] flex items-center gap-4">
                        <div className="p-3 rounded-2xl bg-rose-500/10 text-rose-400">
                          <Heart size={24} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Liked Tracks</p>
                          <p className="text-2xl font-black text-white mt-0.5">{likedTracks.length} Songs</p>
                        </div>
                      </div>

                      <div className="glass-panel p-6 rounded-3xl border border-white/10 bg-[#151515] flex items-center gap-4">
                        <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-400">
                          <ShieldCheck size={24} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Account Status</p>
                          <p className="text-2xl font-black text-emerald-400 mt-0.5">Verified Active</p>
                        </div>
                      </div>
                    </div>

                    {/* Edit Profile Quick Card */}
                    <div className="glass-panel p-6 rounded-3xl border border-white/10 bg-[#181818] space-y-4">
                      <h3 className="text-lg font-extrabold text-white">Update Account Profile</h3>
                      <div className="max-w-md">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">Display Name</label>
                        <input
                          type="text"
                          value={userProfile.name}
                          onChange={(e) => saveProfile({ ...userProfile, name: e.target.value })}
                          className="w-full bg-slate-900 border border-white/10 focus:border-violet-500 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : activeTab === 'settings' ? (
              <motion.div key="settings" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} className="max-w-6xl mx-auto space-y-8 pb-32">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-4xl font-black text-white tracking-tight">Settings</h1>
                    <p className="text-sm text-slate-400 mt-1 font-medium">Manage your profile, audio engine, search sources, and playback options</p>
                  </div>
                </div>

                {/* Section 1: User Account Banner */}
                <div className="glass-panel p-6 rounded-3xl border border-white/10 bg-gradient-to-r from-violet-900/30 via-slate-900/80 to-cyan-900/30 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl">
                  <div className="flex items-center gap-4">
                    <div className={`w-16 h-16 rounded-full border-2 ${userProfile.avatarUrl ? 'border-white' : 'border-white/20'} flex items-center justify-center font-black text-lg text-white shadow-2xl bg-gradient-to-br ${userProfile.avatarGradient || 'from-purple-600 to-emerald-500'} overflow-hidden shrink-0`}>
                      {userProfile.avatarUrl ? (
                        <img src={userProfile.avatarUrl} className="w-full h-full object-cover" alt={userProfile.name} />
                      ) : (
                        getInitials(userProfile.name)
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-extrabold text-white">{userProfile.name}</h3>
                        <span className="px-2.5 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/40 text-violet-300 text-[10px] font-black uppercase tracking-widest">PRO Active</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setEditName(userProfile.name);
                      setEditEmail(userProfile.email || '');
                      setEditAvatarUrl(userProfile.avatarUrl || '');
                      setEditGradient(userProfile.avatarGradient || 'from-purple-600 to-emerald-500');
                      setShowProfileModal(true);
                    }}
                    className="px-5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all shadow-md flex items-center gap-2 self-start md:self-auto"
                  >
                    <Settings size={16} />
                    <span>Edit Profile & Avatar</span>
                  </button>
                </div>


                {/* Section 3: Audio Equalizer */}
                <div className="space-y-4 pt-2">
                  <h3 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
                    <Volume2 size={20} className="text-violet-400" /> Audio Equalizer & Studio Processing
                  </h3>
                  <Equalizer />
                </div>


                {/* Section 5: Local Storage & App Info */}
                <div className="space-y-4 pt-2">
                  <h3 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
                    <HardDrive size={20} className="text-cyan-400" /> System & Local Library
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="glass-panel p-5 rounded-3xl border border-white/10 bg-slate-900/60 flex flex-col justify-between h-36">
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Scanned Music Tracks</p>
                        <p className="text-3xl font-black text-white mt-2">{tracks.length} Songs</p>
                      </div>
                      <button onClick={handleScanClick} className="text-xs font-bold text-violet-400 hover:underline flex items-center gap-1">
                        <FolderOpen size={14} /> Scan Music Directory
                      </button>
                    </div>

                    <div className="glass-panel p-5 rounded-3xl border border-white/10 bg-slate-900/60 flex flex-col justify-between h-36">
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Offline Song Cache</p>
                        <p className="text-3xl font-black text-white mt-2">{likedTracks.length} Saved</p>
                      </div>
                      <button onClick={() => setActiveTab('liked')} className="text-xs font-bold text-violet-400 hover:underline flex items-center gap-1">
                        <Heart size={14} /> View Liked Songs
                      </button>
                    </div>

                    <div className="glass-panel p-5 rounded-3xl border border-white/10 bg-slate-900/60 flex flex-col justify-between h-36">
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">App Version</p>
                        <p className="text-3xl font-black text-white mt-2">v0.1.0</p>
                      </div>
                      <p className="text-xs font-bold text-cyan-400 flex items-center gap-1">
                        <Check size={14} /> Latest Release Active
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : activeTab === 'premium' ? (
              <motion.div
                key="premium"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -20, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="max-w-5xl mx-auto py-4 space-y-10 pb-32"
              >
                {/* Premium Hero Banner */}
                <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-amber-500/20 via-yellow-500/10 to-purple-600/20 border border-amber-500/30 p-8 md:p-12 text-center shadow-[0_0_50px_rgba(245,158,11,0.15)]">
                  <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-300 text-xs font-bold uppercase tracking-widest mb-6 animate-pulse">
                    <Sparkles size={14} /> MUZISO PRO ULTRA MAX VIP
                  </div>
                  <h1 className="text-4xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 tracking-tight mb-4">
                    Unlock Infinite Audio Supremacy
                  </h1>
                  <p className="text-slate-300 text-base md:text-lg max-w-2xl mx-auto mb-8 font-light leading-relaxed">
                    Upgrade today to experience 8K Quantum Audio, Telepathic AI Playlist Generation, and Holographic Artist Holograms in your living room.
                  </p>
                  <button
                    onClick={() => setShowPrankModal(true)}
                    className="px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 text-black font-extrabold text-lg shadow-[0_0_30px_rgba(245,158,11,0.6)] hover:scale-105 active:scale-95 transition-all duration-300 flex items-center gap-3 mx-auto"
                  >
                    <Crown size={22} className="text-black" />
                    <span>UPGRADE TO PRO FOR $99.99/MO</span>
                  </button>
                </div>

                {/* Pricing Cards Comparison */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Standard Plan */}
                  <div className="glass-panel p-6 rounded-3xl border border-white/10 flex flex-col justify-between hover:border-white/20 transition-all">
                    <div>
                      <span className="text-xs font-bold tracking-widest text-neutral-400 uppercase">Muziso Standard</span>
                      <h3 className="text-3xl font-black text-white mt-1 mb-2">$0 <span className="text-xs font-normal text-neutral-400">/ forever</span></h3>
                      <p className="text-xs text-neutral-400 mb-6">Basic tier for casual listeners.</p>
                      <ul className="space-y-3 text-sm text-slate-300">
                        <li className="flex items-center gap-2"><Check size={16} className="text-emerald-400" /> Unlimited Ad-Free Streaming</li>
                        <li className="flex items-center gap-2"><Check size={16} className="text-emerald-400" /> FLAC & High-Res Downloads</li>
                        <li className="flex items-center gap-2"><Check size={16} className="text-emerald-400" /> YouTube, SoundCloud, Spotify</li>
                        <li className="flex items-center gap-2"><Check size={16} className="text-emerald-400" /> Synced Synchronized Lyrics</li>
                        <li className="flex items-center gap-2"><Check size={16} className="text-emerald-400" /> 10-Band Equalizer Presets</li>
                      </ul>
                    </div>
                    <button onClick={() => setShowPrankModal(true)} className="w-full py-3 mt-8 rounded-xl bg-white/10 text-white font-bold hover:bg-white/20 transition-all">
                      Your Current Active Plan
                    </button>
                  </div>

                  {/* ULTRA PRO MAX Plan */}
                  <div className="glass-panel p-6 rounded-3xl border-2 border-amber-400/60 bg-gradient-to-b from-amber-500/10 to-purple-900/20 flex flex-col justify-between relative shadow-[0_0_40px_rgba(245,158,11,0.2)]">
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 text-black font-extrabold text-[10px] uppercase tracking-widest shadow-md">
                      MOST POPULAR
                    </span>
                    <div>
                      <span className="text-xs font-bold tracking-widest text-amber-300 uppercase">Muziso PRO MAX</span>
                      <h3 className="text-3xl font-black text-amber-200 mt-1 mb-2">$99.99 <span className="text-xs font-normal text-amber-400/80">/ month</span></h3>
                      <p className="text-xs text-amber-200/70 mb-6">For true audio snobs and dimension hoppers.</p>
                      <ul className="space-y-3 text-sm text-slate-200">
                        <li className="flex items-center gap-2"><Sparkles size={16} className="text-amber-400" /> 8K Quantum Audio Processing</li>
                        <li className="flex items-center gap-2"><Sparkles size={16} className="text-amber-400" /> Telepathic AI Song Predictor</li>
                        <li className="flex items-center gap-2"><Sparkles size={16} className="text-amber-400" /> Mind-Reading Equalizer</li>
                        <li className="flex items-center gap-2"><Sparkles size={16} className="text-amber-400" /> 0.0000ms Zero-Latency Teleport</li>
                        <li className="flex items-center gap-2"><Sparkles size={16} className="text-amber-400" /> Dedicated 24/7 VIP Butler</li>
                      </ul>
                    </div>
                    <button onClick={() => setShowPrankModal(true)} className="w-full py-3 mt-8 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-400 text-black font-extrabold hover:scale-102 active:scale-95 transition-all shadow-[0_0_20px_rgba(245,158,11,0.4)]">
                      UPGRADE TO PRO MAX
                    </button>
                  </div>

                  {/* GOD TIER VIP Plan */}
                  <div className="glass-panel p-6 rounded-3xl border border-purple-500/40 bg-gradient-to-b from-purple-500/10 to-indigo-900/20 flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-bold tracking-widest text-purple-300 uppercase">GOD TIER VIP</span>
                      <h3 className="text-3xl font-black text-purple-200 mt-1 mb-2">$999 <span className="text-xs font-normal text-purple-400/80">/ month</span></h3>
                      <p className="text-xs text-purple-300/70 mb-6">Literally bends the laws of physics for sound.</p>
                      <ul className="space-y-3 text-sm text-slate-300">
                        <li className="flex items-center gap-2"><Zap size={16} className="text-purple-400" /> Teleport Artists To Your Room</li>
                        <li className="flex items-center gap-2"><Zap size={16} className="text-purple-400" /> Infinite Bass (Shatters Glass)</li>
                        <li className="flex items-center gap-2"><Zap size={16} className="text-purple-400" /> Time-Travel Playlist Rewind</li>
                        <li className="flex items-center gap-2"><Zap size={16} className="text-purple-400" /> Direct Neural Brainwave Audio</li>
                      </ul>
                    </div>
                    <button onClick={() => setShowPrankModal(true)} className="w-full py-3 mt-8 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition-all shadow-[0_0_20px_rgba(168,85,247,0.4)]">
                      BECOME A MUSIC GOD
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <MusicNews
                viewMode={viewMode}
                setViewMode={setViewMode}
                likedTracks={likedTracks}
                userProfile={userProfile}
                news={trendingNews}
                playlists={trendingPlaylists}
                loading={trendingNewsLoading}
                onSelect={(track) => {
                  const playTrackObj = {
                    id: track.url || `sp-${track.title} ${track.artist}`,
                    title: track.title,
                    artist: track.artist,
                    artwork_url: track.artwork_url,
                    source: 'spotify'
                  };
                  handleStreamExternalAudio(playTrackObj, 'search');
                }}
                onStreamTrack={(track) => {
                  handleStreamExternalAudio(track as any, 'search');
                }}
                onPlayPlaylist={handleOpenExternalPlaylist}
              />
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* ELEVATED MUZISO FLOATING AUDIO PLAYER DECK */}
      <footer
        className="mx-3 mb-3 h-20 rounded-2xl border border-white/15 px-5 flex items-center justify-between z-[100] shrink-0 transition-all duration-700 bg-zinc-950/90 backdrop-blur-2xl shadow-[0_10px_35px_rgba(0,0,0,0.8)]"
        style={{
          borderColor: `rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.25)`
        }}
      >
        {/* Left: Artwork, Title, Artist, Heart */}
        <div className="flex items-center gap-3.5 w-1/4 min-w-0">
          <div className="w-13 h-13 rounded-xl overflow-hidden shrink-0 bg-zinc-900 border border-white/10 shadow-lg group relative">
            {(playerTrack?.artwork_url || coverArt) ? (
              <img src={playerTrack?.artwork_url || coverArt || ""} className="w-full h-full object-cover" alt="Cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                <img src={logoImg} alt="Muziso" className="w-8 h-8 object-contain opacity-60 brightness-120" />
              </div>
            )}
          </div>
          <div className="flex flex-col truncate min-w-0">
            <span onClick={() => playerTrack && setIsExpanded(true)} className={`font-bold text-xs md:text-sm truncate hover:underline cursor-pointer transition-colors ${playerTrack ? 'text-white font-black' : 'text-zinc-500 italic'}`}>{playerTrack ? stripExtension(playerTrack.title) : "No song playing"}</span>
            <span onClick={() => playerTrack && setIsExpanded(true)} className="text-[11px] text-zinc-400 truncate hover:underline cursor-pointer">{playerTrack?.artist || "Muziso Player"}</span>
          </div>
          <button
            onClick={() => playerTrack && toggleLike(playerTrack, lyricsData?.syncedLyrics || lyricsData?.plainLyrics)}
            className="text-zinc-400 hover:text-white p-1.5 ml-1 shrink-0 transition-all hover:scale-110"
          >
            <Heart size={18} fill={likedTracks.some(t => t.id === (playerTrack?.id || playerTrack?.stream_url)) ? "#ffffff" : "none"} style={{ color: likedTracks.some(t => t.id === (playerTrack?.id || playerTrack?.stream_url)) ? "#ffffff" : undefined }} />
          </button>
        </div>

        {/* Center: Playback Controls & Progress Bar */}
        <div className="flex flex-col items-center justify-center w-2/4 max-w-xl gap-1">
          <div className="flex items-center gap-5">
            <button onClick={toggleShuffle} className="p-1 transition-all hover:scale-110" style={{ color: isShuffle ? '#ccff00' : '#71717a' }}>
              <Shuffle size={16} />
            </button>
            <button onClick={handlePrevTrack} disabled={!currentTrackPath} className="text-zinc-300 hover:text-white transition-all hover:scale-110 disabled:opacity-40">
              <SkipBack size={19} fill="currentColor" />
            </button>
            <button
              onClick={togglePause}
              disabled={!currentTrackPath}
              className={`w-10 h-10 rounded-full hover:scale-105 active:scale-95 text-black bg-white flex items-center justify-center transition-all shadow-[0_0_20px_rgba(255,255,255,0.4)] ${isBuffering ? 'animate-pulse' : ''}`}
            >
              {isBuffering ? (
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              ) : isPlaying ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} fill="currentColor" className="ml-0.5" />
              )}
            </button>
            <button onClick={handleNextTrack} disabled={!currentTrackPath} className="text-zinc-300 hover:text-white transition-all hover:scale-110 disabled:opacity-40">
              <SkipForward size={19} fill="currentColor" />
            </button>
            <button onClick={toggleRepeat} className="p-1 transition-all hover:scale-110" style={{ color: repeatMode !== 'off' ? '#ffffff' : '#71717a' }}>
              {repeatMode === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
            </button>
          </div>

          <ProgressBar positionMs={positionMs} durationMs={(durationMs && durationMs > 0) ? durationMs : (positionMs === 0 ? (playerTrack?.duration_ms || 0) : 0)} onSeek={handleSeek} />
        </div>

        {/* Right: Lyrics, Queue, Volume, Fullscreen */}
        <div className="flex items-center justify-end gap-3 w-1/4">
          <button onClick={() => playerTrack && setIsExpanded(true)} className="text-zinc-400 hover:text-white p-1.5 transition-colors" title="Lyrics">
            <ListMusic size={18} />
          </button>
          <button
            onClick={() => setShowQueueDrawer(prev => !prev)}
            className={`p-1.5 transition-all relative ${showQueueDrawer ? 'text-white scale-110' : 'text-zinc-400 hover:text-white'}`}
            title="Play Queue"
          >
            <List size={18} />
            {queue.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white text-black font-extrabold text-[9px] flex items-center justify-center shadow-md">
                {queue.length}
              </span>
            )}
          </button>
          <VolumeControl volume={volume} onChange={setVolume} />
          <button onClick={toggleMiniplayerMode} className="text-zinc-400 hover:text-white p-1.5 transition-colors" title="Miniplayer">
            <Maximize2 size={18} />
          </button>
        </div>
      </footer>

      {/* User Profile Edit & Login Modal */}
      <AnimatePresence>
        {showProfileModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl">
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-[#181818] max-w-md w-full p-6 md:p-8 rounded-3xl border border-white/15 shadow-2xl relative space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-black text-white tracking-tight">Account Profile</h3>
                <button onClick={() => setShowProfileModal(false)} className="p-2 rounded-full hover:bg-white/10 text-neutral-400 hover:text-white transition-all">
                  <X size={20} />
                </button>
              </div>

              {/* Avatar Preview */}
              <div className="flex flex-col items-center justify-center gap-3">
                <div 
                  onClick={async () => {
                    try {
                      const selected = await open({
                        multiple: false,
                        filters: [{
                          name: 'Image',
                          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']
                        }]
                      });
                      if (selected && typeof selected === 'string') {
                        const converted = convertFileSrc(selected);
                        setEditAvatarUrl(converted);
                      }
                    } catch (err) {
                      console.error("Failed to select avatar image:", err);
                    }
                  }}
                  className={`w-20 h-20 rounded-full border-2 ${editAvatarUrl ? 'border-white' : 'border-white/20'} flex items-center justify-center font-black text-xl text-white shadow-2xl bg-gradient-to-br ${editGradient} overflow-hidden relative group cursor-pointer hover:scale-105 transition-all`}
                  title="Click to upload custom avatar image"
                >
                  {editAvatarUrl ? (
                    <img src={editAvatarUrl} className="w-full h-full object-cover group-hover:opacity-40 transition-opacity" alt="Preview" />
                  ) : (
                    <span className="group-hover:opacity-20 transition-opacity">{getInitials(editName)}</span>
                  )}
                  {/* Upload overlay on hover */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-1 transition-all duration-300 text-white">
                    <FolderOpen size={20} className="text-white" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-center leading-none">Upload</span>
                  </div>
                </div>
                <p className="text-xs text-neutral-400 font-medium text-center">Click the avatar circle to upload an image, or select a gradient below</p>
                <div className="flex items-center gap-2">
                  {AVATAR_GRADIENTS.map((g) => (
                    <button
                      key={g.label}
                      onClick={() => { setEditGradient(g.class); setEditAvatarUrl(''); }}
                      className={`w-7 h-7 rounded-full bg-gradient-to-br ${g.class} border transition-all ${editGradient === g.class && !editAvatarUrl ? 'scale-125 border-white shadow-lg' : 'border-transparent opacity-70 hover:opacity-100'}`}
                      title={g.label}
                    />
                  ))}
                </div>
              </div>

              {/* Input Form */}
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest block mb-1">Your Name / Display Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Enter your name e.g. John Doe"
                    className="w-full bg-[#121212] border border-white/10 focus:border-[#1db954] rounded-2xl px-4 py-3 text-sm text-white focus:outline-none transition-all"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => {
                    const updated: UserProfile = {
                      name: editName.trim() || 'Guest Listener',
                      email: editEmail.trim(),
                      avatarUrl: editAvatarUrl.trim() || undefined,
                      avatarGradient: editGradient,
                      isLoggedIn: true
                    };
                    saveProfile(updated);
                  }}
                  className="flex-1 py-3.5 rounded-2xl bg-[#1db954] hover:bg-[#1ed760] text-black font-extrabold text-sm transition-all shadow-lg hover:scale-102 active:scale-98"
                >
                  Save Profile
                </button>
                <button
                  onClick={() => setShowProfileModal(false)}
                  className="px-5 py-3.5 rounded-2xl bg-white/10 hover:bg-white/15 text-white font-bold text-sm transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Premium Prank Modal Reveal */}
      <AnimatePresence>
        {showPrankModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl">
            <motion.div
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 20 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              className="glass-panel max-w-lg w-full p-8 rounded-3xl border border-amber-400/50 bg-zinc-900/90 text-center relative overflow-hidden shadow-[0_0_80px_rgba(245,158,11,0.3)]"
            >
              <div className="w-20 h-20 mx-auto mb-4 rounded-3xl bg-gradient-to-tr from-amber-400 to-yellow-300 p-4 flex items-center justify-center text-black shadow-[0_0_30px_rgba(245,158,11,0.6)] animate-bounce">
                <Crown size={44} />
              </div>

              <h2 className="text-3xl font-black text-white tracking-tight mb-2">
                🎉 GOTCHA! IT'S A PRANK! 🤣
              </h2>
              <p className="text-amber-300 font-bold text-xs uppercase tracking-widest mb-4">
                100% FREE FOREVER • NO PAID TIERS • NO PAYWALLS
              </p>

              <div className="bg-white/5 rounded-2xl p-4 border border-white/10 mb-6 text-slate-300 text-sm leading-relaxed text-left">
                <p className="mb-2">
                  <span className="font-bold text-white">Hey there!</span> Muziso does NOT have any paid tiers, subscriptions, or paywalls.
                </p>
                <p>
                  Every feature — including <strong>unlimited streaming, FLAC downloads, YouTube/SoundCloud/Spotify support, synced lyrics, and 10-band equalizer</strong> — is 100% FREE for everyone forever! Enjoy your music! 🎵
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => setShowPrankModal(false)}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 text-black font-extrabold text-base shadow-[0_0_25px_rgba(245,158,11,0.4)] hover:scale-102 active:scale-95 transition-all"
                >
                  Haha, Nice One! Let Me Listen 🎵
                </button>
                <button
                  onClick={() => {
                    setPrankToast("Payment Failed: Muziso refuses your money! Keep your cash and enjoy free tunes! 💸🎵");
                    setTimeout(() => setPrankToast(null), 4500);
                  }}
                  className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-semibold transition-all"
                >
                  Take my money anyway! 💸
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Add to Playlist Modal ── */}
      <AnimatePresence>
        {showAddToPlaylistModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl">
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-[#18181a] border border-white/10 max-w-md w-full p-6 rounded-3xl shadow-2xl relative flex flex-col max-h-[85vh]"
            >
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <div>
                  <h3 className="text-xl font-black text-white tracking-tight">Add to Playlist</h3>
                  <p className="text-xs text-neutral-400 mt-1 truncate max-w-[280px]">
                    "{showAddToPlaylistModal.title}"
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowAddToPlaylistModal(null);
                    setNewPlaylistName("");
                  }}
                  className="p-2 rounded-full hover:bg-white/10 text-neutral-400 hover:text-white transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Create Playlist Inline */}
              <div className="py-4 border-b border-white/10">
                <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest block mb-2">Create New Playlist</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter playlist name..."
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newPlaylistName.trim()) {
                        const newPl = createPlaylist(newPlaylistName);
                        if (newPl) {
                          addTrackToPlaylist(newPl.id, showAddToPlaylistModal);
                          setPrankToast(`Created playlist "${newPl.name}" and added song!`);
                          setTimeout(() => setPrankToast(null), 3000);
                          setShowAddToPlaylistModal(null);
                          setNewPlaylistName("");
                        }
                      }
                    }}
                    className="flex-1 bg-black/40 border border-white/10 focus:border-[#ccff00] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none transition-all"
                  />
                  <button
                    onClick={() => {
                      if (newPlaylistName.trim()) {
                        const newPl = createPlaylist(newPlaylistName);
                        if (newPl) {
                          addTrackToPlaylist(newPl.id, showAddToPlaylistModal);
                          setPrankToast(`Created playlist "${newPl.name}" and added song!`);
                          setTimeout(() => setPrankToast(null), 3000);
                          setShowAddToPlaylistModal(null);
                          setNewPlaylistName("");
                        }
                      }
                    }}
                    disabled={!newPlaylistName.trim()}
                    className="px-4 py-2.5 rounded-xl bg-[#ccff00] hover:bg-[#b5e600] disabled:bg-neutral-800 disabled:text-neutral-500 text-black font-extrabold text-xs transition-all shadow-md active:scale-95"
                  >
                    Create & Add
                  </button>
                </div>
              </div>

              {/* Playlists List */}
              <div className="flex-1 overflow-y-auto py-4 space-y-2 min-h-[200px] max-h-[350px] custom-scrollbar">
                <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest block mb-1">Your Playlists</label>
                
                {playlists.length === 0 ? (
                  <div className="py-8 text-center text-neutral-500 text-xs">
                    <ListMusic size={32} className="mx-auto mb-2 opacity-40" />
                    <p>No playlists yet.</p>
                    <p className="mt-1">Create one above to get started!</p>
                  </div>
                ) : (
                  playlists.map((pl) => {
                    const isAlreadyIn = pl.tracks.some((t: any) => (t.id || t.filepath) === (showAddToPlaylistModal.id || showAddToPlaylistModal.filepath));
                    return (
                      <div
                        key={pl.id}
                        onClick={() => {
                          addTrackToPlaylist(pl.id, showAddToPlaylistModal);
                          setPrankToast(isAlreadyIn ? `"${showAddToPlaylistModal.title}" is already in "${pl.name}"!` : `Added to playlist "${pl.name}"!`);
                          setTimeout(() => setPrankToast(null), 3000);
                          setShowAddToPlaylistModal(null);
                        }}
                        className={`flex items-center justify-between p-2.5 rounded-xl hover:bg-white/5 cursor-pointer transition-all border ${isAlreadyIn ? 'border-[#ccff00]/25 bg-[#ccff00]/5' : 'border-transparent'}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-neutral-800">
                            {pl.artwork_url ? (
                              <img src={pl.artwork_url} className="w-full h-full object-cover" alt="" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                                <ListMusic size={16} className="text-neutral-500" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-white text-xs font-bold truncate">{pl.name}</p>
                            <p className="text-neutral-500 text-[10px] truncate mt-0.5">{pl.tracks.length} songs</p>
                          </div>
                        </div>
                        {isAlreadyIn && (
                          <span className="text-[#ccff00] text-xs font-bold mr-2">Added</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Prank Toast Notification */}
      <AnimatePresence>
        {prankToast && (
          <motion.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[110] px-6 py-3.5 rounded-2xl bg-amber-400 text-black font-extrabold text-sm shadow-[0_10px_30px_rgba(245,158,11,0.6)] border border-amber-300 flex items-center gap-2.5"
          >
            <Sparkles size={20} />
            <span>{prankToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded Player Overlay */}
      <AnimatePresence>
        {isExpanded && playerTrack && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", bounce: 0, duration: 0.4 }}
            className="fixed inset-0 z-[100] bg-zinc-950 overflow-hidden flex"
            style={{
              ['--theme-accent' as any]: `rgb(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b})`,
              ['--theme-accent-rgb' as any]: `${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}`
            }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.8}
            onDragEnd={(_, info) => {
              if (info.offset.y > 150 || info.velocity.y > 500) {
                setIsExpanded(false);
              }
            }}
          >
            {/* Apple Music Style Blurred Artwork Background */}
            <div className="absolute inset-0 z-0 overflow-hidden bg-black contain-strict" style={{ transform: 'translateZ(0)' }}>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1 }}
                className="absolute inset-[-10%] w-[120%] h-[120%] z-0"
                style={{
                  backgroundImage: `url(${playerTrack?.artwork_url || coverArt || ""})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'blur(80px) saturate(150%)',
                  opacity: 0.6
                }}
              />
              <div className="absolute inset-0 bg-black/40 pointer-events-none" />
            </div>

            <div className="absolute top-8 inset-x-8 z-50 flex justify-between items-center pointer-events-none">
              <button
                onClick={() => setIsExpanded(false)}
                className="p-3 rounded-full bg-black/20 hover:bg-black/40 backdrop-blur-md transition-colors text-white pointer-events-auto shadow-md"
              >
                <ChevronDown size={28} />
              </button>

              <div className="flex items-center gap-2 pointer-events-auto">
                {getYouTubeVideoId(playerTrack) && (
                  <button
                    onClick={() => setVideoMode(!videoMode)}
                    className={`p-3 rounded-full transition-colors backdrop-blur-md shadow-lg ${videoMode ? 'bg-red-600/80 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]' : 'bg-black/20 hover:bg-black/40 text-white'}`}
                    title={videoMode ? 'Hide video' : 'Show music video'}
                  >
                    <MonitorPlay size={24} />
                  </button>
                )}
                <button
                  onClick={() => setShowLyricsOverlay(!showLyricsOverlay)}
                  className={`p-3 rounded-full transition-colors backdrop-blur-md shadow-lg ${showLyricsOverlay ? 'bg-[var(--theme-accent,#ccff00)] text-black shadow-[0_0_15px_rgba(var(--theme-accent-rgb),0.4)]' : 'bg-black/20 hover:bg-black/40 text-white'}`}
                  title={showLyricsOverlay ? 'Hide Lyrics' : 'Show Lyrics'}
                >
                  <ListMusic size={24} />
                </button>
              </div>
            </div>

            <div className="flex flex-col md:flex-row w-full h-full max-w-[1600px] mx-auto z-10 px-6 md:px-12 pb-32 pt-24 md:pt-28">
              {/* Left Side / Center: Art & Controls */}
              <div className={`w-full transition-all duration-500 flex-col items-center justify-center mt-0 md:mt-0 overflow-y-auto md:overflow-visible no-scrollbar gap-4 md:gap-8 ${showLyricsOverlay ? 'md:w-[45%] md:pr-16 hidden md:flex' : 'md:w-full flex'}`}>
                
                {/* Artwork */}
                <div className={`relative flex items-center justify-center transition-all duration-500 shrink-0 mt-0 md:mt-0 mb-0 md:mb-4 contain-strict ${showLyricsOverlay ? 'w-[65vw] max-w-[320px] md:w-[320px] md:max-w-[400px] lg:w-[420px] aspect-square' : 'w-[75vw] max-w-[400px] md:w-[500px] md:max-w-[600px] lg:w-[550px] aspect-square'}`} style={{ transform: 'translateZ(0)' }}>
                  {videoMode && getYouTubeVideoId(playerTrack) ? (
                    <div className="relative z-10 w-full h-full rounded-[2.5rem] md:rounded-[3.5rem] shadow-2xl overflow-hidden">
                      <iframe
                        ref={(el) => { if (el) { (window as any).__nekobeat_yt_iframe = el; } }}
                        key={getYouTubeVideoId(playerTrack)!}
                        src={`https://www.youtube-nocookie.com/embed/${getYouTubeVideoId(playerTrack)}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&showinfo=0&loop=0&fs=0&disablekb=1&iv_load_policy=3&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
                        className="absolute"
                        style={{ border: 'none', pointerEvents: 'none', top: '-56%', left: '-33%', width: '166%', height: '210%' }}
                        allow="autoplay; encrypted-media"
                        title="Music Video"
                      />
                    </div>
                  ) : (
                    <>
                      <div
                        className="absolute inset-x-8 bottom-[-5%] top-8 opacity-[0.85] blur-[40px] z-0 pointer-events-none transition-all duration-700"
                        style={{
                          willChange: 'transform, opacity',
                          backgroundImage: `url(${playerTrack?.artwork_url || coverArt || ""})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          borderRadius: '2rem'
                        }}
                      />
                      <motion.div
                        layoutId="album-art"
                        whileHover={{ scale: 1.02 }}
                        className={`relative z-10 w-full h-full rounded-[2.5rem] md:rounded-3xl lg:rounded-[3rem] overflow-hidden transition-all duration-700 ${isPlaying ? 'scale-100 shadow-[0_20px_50px_rgba(0,0,0,0.6)]' : 'scale-95 shadow-xl opacity-90'}`}
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0.4}
                        onDragEnd={(_, info) => {
                          if (info.offset.x > 100) handlePrevTrack();
                          else if (info.offset.x < -100) handleNextTrack();
                        }}
                      >
                        <img src={playerTrack?.artwork_url || coverArt || ""} className="w-full h-full object-cover" style={{ borderRadius: 'inherit' }} alt="Album Art" />
                      </motion.div>
                    </>
                  )}
                </div>

                {/* Title & Controls Wrapper */}
                <div className={`w-full flex flex-col transition-all duration-500 ${showLyricsOverlay ? 'max-w-[420px]' : 'max-w-[550px]'}`}>
                  {/* Titles */}
                  <div className="w-full flex items-center justify-between text-left shrink-0 relative z-20 mt-2 md:mt-4 mb-2">
                    <div className="truncate flex-1 min-w-0 pr-2">
                      <h2 className={`font-display font-black text-white mb-1.5 truncate drop-shadow-lg tracking-tight leading-none transition-all ${showLyricsOverlay ? 'text-3xl md:text-3xl' : 'text-3xl md:text-5xl'}`}>{stripExtension(playerTrack.title)}</h2>
                      <p className={`text-white/70 font-semibold font-sans truncate drop-shadow-sm tracking-wide mt-1 transition-all ${showLyricsOverlay ? 'text-lg md:text-xl' : 'text-xl md:text-2xl'}`}>{playerTrack.artist}</p>
                    </div>
                    <button
                      onClick={() => toggleLike(playerTrack, lyricsData?.syncedLyrics || lyricsData?.plainLyrics)}
                      className="p-3 ml-2 focus:outline-none hover:scale-110 active:scale-95 transition-transform bg-white/5 hover:bg-white/10 rounded-full"
                    >
                      {isLiking[playerTrack.id || playerTrack.stream_url || ''] ? (
                        <div className="w-6 h-6 border-2 border-[var(--theme-accent,#1db954)] border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Heart
                          size={28}
                          fill={likedTracks.some(t => t.id === (playerTrack.id || playerTrack.stream_url)) ? `rgb(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b})` : "none"}
                          className={likedTracks.some(t => t.id === (playerTrack.id || playerTrack.stream_url)) ? "transition-colors" : "text-white/80 hover:text-white"}
                          style={{
                            color: likedTracks.some(t => t.id === (playerTrack.id || playerTrack.stream_url)) ? `rgb(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b})` : undefined,
                            filter: likedTracks.some(t => t.id === (playerTrack.id || playerTrack.stream_url)) ? `drop-shadow(0 0 10px rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.8))` : undefined
                          }}
                        />
                      )}
                    </button>
                  </div>

                  {/* Controls */}
                  <div className="w-full flex flex-col items-center justify-center gap-6 mt-6 md:mt-8 px-4 md:px-0">
                    <ExpandedProgressBar positionMs={positionMs} durationMs={(durationMs && durationMs > 0) ? durationMs : (positionMs === 0 ? (playerTrack?.duration_ms || 0) : 0)} onSeek={handleSeek} />
                    
                    <div className="flex items-center gap-6 md:gap-8 w-full justify-between px-2">
                      <button
                        onClick={toggleShuffle}
                        title={isShuffle ? "Shuffle On" : "Shuffle Off"}
                        className="p-2 rounded-full transition-all hover:scale-110 active:scale-95"
                        style={{
                          color: isShuffle ? `rgb(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b})` : 'rgba(255, 255, 255, 0.4)',
                          filter: isShuffle ? `drop-shadow(0 0 8px rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.6))` : undefined
                        }}
                      >
                        <Shuffle size={22} />
                      </button>
                      
                      <div className="flex items-center gap-6 md:gap-8">
                        <button onClick={handlePrevTrack} disabled={!currentTrackPath} aria-label="Previous" className="text-white/80 hover:text-white transition-colors hover:scale-110 active:scale-95 disabled:opacity-50"><SkipBack size={32} fill="currentColor" /></button>
                        <button
                          onClick={togglePause}
                          disabled={!currentTrackPath}
                          aria-label={isPlaying ? "Pause" : "Play"}
                          className="w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center transition-all shadow-xl hover:scale-105 active:scale-95 text-black"
                          style={{
                            backgroundColor: `rgb(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b})`,
                            color: (dynamicTheme.r * 0.299 + dynamicTheme.g * 0.587 + dynamicTheme.b * 0.114) > 150 ? 'black' : 'white',
                            boxShadow: `0 8px 32px rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.4)`
                          }}
                        >
                          {isBuffering ? (
                            <div className="w-8 h-8 border-4 border-current border-t-transparent rounded-full animate-spin" />
                          ) : isPlaying ? (
                            <Pause size={28} fill="currentColor" />
                          ) : (
                            <Play size={28} fill="currentColor" className="ml-1.5" />
                          )}
                        </button>
                        <button onClick={handleNextTrack} disabled={!currentTrackPath} aria-label="Next" className="text-white/80 hover:text-white transition-colors hover:scale-110 active:scale-95 disabled:opacity-50"><SkipForward size={32} fill="currentColor" /></button>
                      </div>

                      <button
                        onClick={toggleRepeat}
                        title={repeatMode === 'one' ? 'Repeat Track (One)' : repeatMode === 'all' ? 'Repeat All (Queue)' : 'Repeat Off'}
                        className="p-2 rounded-full transition-all relative hover:scale-110 active:scale-95"
                        style={{
                          color: repeatMode !== 'off' ? `rgb(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b})` : 'rgba(255, 255, 255, 0.4)',
                          filter: repeatMode !== 'off' ? `drop-shadow(0 0 8px rgba(${dynamicTheme.r}, ${dynamicTheme.g}, ${dynamicTheme.b}, 0.6))` : undefined
                        }}
                      >
                        {repeatMode === 'one' ? <Repeat1 size={22} /> : <Repeat size={22} />}
                      </button>
                    </div>

                    <div className="mt-4 scale-110 hidden md:flex w-full px-8">
                      <VolumeControl volume={volume} onChange={setVolume} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Side: Lyrics Glass Panel */}
              <div className={`w-full md:w-[55%] flex-col h-full relative transition-all duration-500 ease-in-out ${showLyricsOverlay ? 'flex opacity-100 translate-x-0' : 'hidden md:flex opacity-0 translate-x-12 pointer-events-none absolute right-0 top-0 bottom-0'}`}>
                {/* Glassmorphic Container for Lyrics */}
                <div className="w-full h-full rounded-[2rem] md:rounded-[3rem] bg-black/20 backdrop-blur-3xl shadow-[0_0_40px_rgba(0,0,0,0.3)] border border-white/5 overflow-hidden">
                  <LyricsDisplay
                    parsedLyrics={parsedLyrics}
                    activeLyricIndex={activeLyricIndex}
                    hasPlainLyrics={hasPlainLyrics}
                    plainLyricsText={plainLyricsText}
                    lyricsOffsetMs={lyricsOffsetMs}
                    onOffsetChange={handleLyricsOffsetChange}
                    onUploadLyrics={handleUploadLyrics}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Song Right-Click Context Menu ── */}
      <SongContextMenu
        menu={contextMenu}
        onClose={closeContextMenu}
        onPlay={handleContextPlay}
        onAddToQueue={handleContextAddToQueue}
        onLike={handleContextLike}
        isLiked={contextMenu ? likedTracks.some(t => t.id === contextMenu.track.id) : false}
        onCopyTitle={handleContextCopyTitle}
        onSearchArtist={handleContextSearchArtist}
        onAddToPlaylist={(track) => setShowAddToPlaylistModal(track)}
        onRemoveFromPlaylist={(playlistId, track) => {
          removeTrackFromPlaylist(playlistId, track.id || track.filepath || '');
          setPrankToast(`Removed "${track.title}" from playlist!`);
          setTimeout(() => setPrankToast(null), 2500);
        }}
      />

      {/* ── Play Queue Drawer Panel ── */}
      <PlayQueueDrawer
        isOpen={showQueueDrawer}
        onClose={() => setShowQueueDrawer(false)}
        queue={queue}
        onClearQueue={() => setQueue([])}
        onRemoveFromQueue={(index) => setQueue(prev => prev.filter((_, i) => i !== index))}
        onPlayQueuedTrack={(track, index) => {
          setQueue(prev => prev.filter((_, i) => i !== index));
          handleStreamExternalAudio(
            { ...track, stream_url: getTrackPlaybackUrl(track) },
            track.playbackContext || 'queue',
            false
          );
        }}
        currentTrack={playerTrack}
        autoplayTrack={getAutoplayTrack()}
        onPlayAutoplayTrack={(track) => {
          if (!track.source || track.source === 'local') {
            playTrack(track.filepath);
          } else {
            handleStreamExternalAudio(
              { ...track, stream_url: getTrackPlaybackUrl(track) },
              track.playbackContext || 'autoplay',
              false
            );
          }
        }}
      />

      {/* ── Queue Toast ── */}
      <AnimatePresence>
        {queueToast && (
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-2xl text-sm font-semibold flex items-center gap-2.5 shadow-2xl"
            style={{
              background: 'rgba(20,20,22,0.92)',
              backdropFilter: 'blur(20px)',
              border: '1px solid var(--theme-border)',
              color: 'white',
              boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 24px var(--theme-glow)`
            }}
          >
            <ListMusic size={16} style={{ color: 'var(--theme-accent)' }} />
            {queueToast}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {customPrompt.isOpen && (
          <PromptDialog
            title={customPrompt.title}
            defaultValue={customPrompt.defaultValue}
            onConfirm={(val) => {
              if (customPrompt.resolve) customPrompt.resolve(val);
              setCustomPrompt(prev => ({ ...prev, isOpen: false }));
            }}
            onCancel={() => {
              if (customPrompt.resolve) customPrompt.resolve(null);
              setCustomPrompt(prev => ({ ...prev, isOpen: false }));
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {customConfirm.isOpen && (
          <ConfirmDialog
            title={customConfirm.title}
            message={customConfirm.message}
            onConfirm={() => {
              if (customConfirm.resolve) customConfirm.resolve(true);
              setCustomConfirm(prev => ({ ...prev, isOpen: false }));
            }}
            onCancel={() => {
              if (customConfirm.resolve) customConfirm.resolve(false);
              setCustomConfirm(prev => ({ ...prev, isOpen: false }));
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function PlayQueueDrawer({
  isOpen,
  onClose,
  queue,
  onClearQueue,
  onRemoveFromQueue,
  onPlayQueuedTrack,
  currentTrack,
  autoplayTrack,
  onPlayAutoplayTrack
}: {
  isOpen: boolean;
  onClose: () => void;
  queue: any[];
  onClearQueue: () => void;
  onRemoveFromQueue: (index: number) => void;
  onPlayQueuedTrack: (track: any, index: number) => void;
  currentTrack: any;
  autoplayTrack: any;
  onPlayAutoplayTrack: (track: any) => void;
}) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[140]" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="fixed bottom-24 right-4 md:right-8 w-96 max-w-[calc(100vw-2rem)] max-h-[75vh] z-[150] rounded-2xl bg-zinc-950/95 border border-white/15 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <List size={18} className="text-white" />
            <h3 className="font-black text-sm text-white tracking-tight">Play Queue</h3>
            {queue.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-white/10 text-zinc-300 text-[10px] font-bold">
                {queue.length} queued
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {queue.length > 0 && (
              <button
                onClick={onClearQueue}
                className="text-[11px] text-zinc-400 hover:text-white font-semibold transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
              >
                Clear All
              </button>
            )}
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content Scroll Container */}
        <div className="flex-1 overflow-y-auto no-scrollbar py-3 space-y-4 pr-1">
          {/* NOW PLAYING SECTION */}
          {currentTrack && (
            <div className="space-y-2">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-400 px-1">Now Playing</span>
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/10 border border-white/15 shadow-md">
                <div className="w-11 h-11 rounded-lg bg-zinc-900 overflow-hidden shrink-0 relative border border-white/10">
                  <img src={currentTrack.artwork_url || currentTrack.artwork || `https://picsum.photos/seed/${encodeURIComponent(currentTrack.title || '')}/200`} className="w-full h-full object-cover" alt="" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-white truncate leading-tight">{stripExtension(currentTrack.title)}</p>
                  <p className="text-[11px] text-zinc-400 truncate mt-0.5">{currentTrack.artist || 'Muziso Player'}</p>
                </div>
                <div className="flex items-end gap-0.5 pr-2 shrink-0">
                  <span className="w-0.5 h-2 rounded-full bg-white eq-bar-1" />
                  <span className="w-0.5 h-3 rounded-full bg-zinc-300 eq-bar-2" />
                  <span className="w-0.5 h-1.5 rounded-full bg-white eq-bar-3" />
                </div>
              </div>
            </div>
          )}

          {/* QUEUED SONGS SECTION */}
          <div className="space-y-2">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-400 px-1">Up Next (Queue)</span>

            {queue.length === 0 ? (
              <div className="p-5 text-center rounded-xl bg-zinc-900/60 border border-dashed border-white/10 space-y-1">
                <ListMusic size={24} className="mx-auto text-zinc-500 opacity-60" />
                <p className="text-xs font-semibold text-zinc-300">Your Queue is Empty</p>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Right-click any song and select <span className="text-white font-bold">"Add to Queue"</span> to set it to play next!
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {queue.map((track, idx) => (
                  <div
                    key={track.id + '-' + idx}
                    className="group flex items-center gap-2.5 p-2 rounded-xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-white/5 hover:border-white/20 transition-all cursor-pointer"
                    onClick={() => onPlayQueuedTrack(track, idx)}
                  >
                    <span className="text-[11px] font-bold text-zinc-500 w-4 text-center shrink-0">{idx + 1}</span>
                    <div className="w-9 h-9 rounded-lg bg-zinc-800 overflow-hidden shrink-0 border border-white/10">
                      <img src={track.artwork_url || track.artwork || `https://picsum.photos/seed/${encodeURIComponent(track.title || '')}/200`} className="w-full h-full object-cover" alt="" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-white truncate leading-tight group-hover:text-zinc-200">{stripExtension(track.title)}</p>
                      <p className="text-[10px] text-zinc-400 truncate mt-0.5">{track.artist || 'Unknown Artist'}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveFromQueue(idx);
                      }}
                      className="p-1 text-zinc-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 rounded"
                      title="Remove from queue"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AUTOPLAY SECTION */}
          {autoplayTrack && (
            <div className="space-y-2 pt-3 border-t border-white/10 shrink-0">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-400">Autoplay (Up Next)</span>
                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">
                  Next in {autoplayTrack.playbackContext === 'liked' ? 'Liked Songs' : 
                           autoplayTrack.playbackContext === 'recent' ? 'Recently Played' : 
                           autoplayTrack.playbackContext === 'local' ? 'Local Library' : 
                           autoplayTrack.playbackContext === 'autoplay' ? 'Related Songs (Radio)' :
                           autoplayTrack.playbackContext?.startsWith('playlist-') ? 'Your Playlist' : 
                           autoplayTrack.playbackContext === 'external-playlist' ? 'Mix / Playlist' : 
                           'Search Results'}
                </span>
              </div>
              <div
                className="group flex items-center gap-2.5 p-2 rounded-xl bg-zinc-900/40 hover:bg-zinc-800/60 border border-white/5 hover:border-white/15 transition-all cursor-pointer"
                onClick={() => onPlayAutoplayTrack(autoplayTrack)}
              >
                <div className="w-9 h-9 rounded-lg bg-zinc-800 overflow-hidden shrink-0 border border-white/10">
                  <img src={autoplayTrack.artwork_url || autoplayTrack.artwork || `https://picsum.photos/seed/${encodeURIComponent(autoplayTrack.title || '')}/200`} className="w-full h-full object-cover" alt="" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate leading-tight group-hover:text-zinc-200">{stripExtension(autoplayTrack.title)}</p>
                  <p className="text-[10px] text-zinc-400 truncate mt-0.5">{autoplayTrack.artist || 'Unknown Artist'}</p>
                </div>
                <div className="text-[10px] font-bold text-zinc-500 pr-2 shrink-0">Auto</div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function NavItem({ icon, label, active = false, hideLabelOnMobile = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; hideLabelOnMobile?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col md:flex-row items-center justify-center md:justify-start gap-1.5 md:gap-3.5 px-3 md:px-4 py-2 md:py-2.5 rounded-xl transition-all duration-300 font-bold w-full active:scale-95 group ${active
        ? 'bg-white text-black border border-white shadow-lg shadow-white/10'
        : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
        }`}
    >
      {active && (
        <span className="hidden md:block absolute left-0 inset-y-2 w-1 bg-black rounded-r-full" />
      )}
      <span className={`transition-transform duration-300 group-hover:scale-110 ${active ? "text-black" : ""}`}>
        {icon}
      </span>
      <span className={`text-[11px] md:text-sm tracking-tight ${hideLabelOnMobile ? 'hidden md:inline' : ''} ${active ? 'text-black font-black' : 'font-medium'}`}>
        {label}
      </span>
    </button>
  );
}

function HeroSearch({ value, onChange, isSearching, source, onSourceChange, activeSources, onFocus, onBlur, onSelectVariety }: { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; isSearching: boolean, source: string, onSourceChange: (s: any) => void, activeSources: Record<string, boolean>, onFocus: () => void, onBlur: () => void, onSelectVariety?: (tag: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('muziso_search_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Keyboard shortcut Ctrl+K / Cmd+K handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const saveToHistory = (query: string) => {
    if (!query.trim()) return;
    const filtered = searchHistory.filter(q => q.toLowerCase() !== query.trim().toLowerCase());
    const updated = [query.trim(), ...filtered].slice(0, 5);
    setSearchHistory(updated);
    localStorage.setItem('muziso_search_history', JSON.stringify(updated));
  };

  const removeFromHistory = (query: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = searchHistory.filter(q => q !== query);
    setSearchHistory(updated);
    localStorage.setItem('muziso_search_history', JSON.stringify(updated));
  };

  const varietyTags = [
    { label: "Lofi Beats", icon: <Music size={14} className="text-sky-400" /> },
    { label: "Phonk", icon: <Zap size={14} className="text-amber-400" /> },
    { label: "Synthwave", icon: <Sparkles size={14} className="text-purple-400" /> },
    { label: "Chillhop", icon: <Radio size={14} className="text-emerald-400" /> },
    { label: "Acoustic", icon: <Disc size={14} className="text-rose-400" /> },
    { label: "Deep House", icon: <Flame size={14} className="text-orange-400" /> },
    { label: "Anime OST", icon: <Compass size={14} className="text-indigo-400" /> },
    { label: "Workout High Energy", icon: <Zap size={14} className="text-red-400" /> },
  ];

  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 200, damping: 25 }}
      className="relative w-full max-w-4xl mx-auto px-4 flex flex-col gap-6"
    >
      {/* Search Bar Input Container */}
      <motion.div layout className="relative group">
        {/* Glow ambient background ring */}
        <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-amber-500/20 via-yellow-400/20 to-purple-600/20 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 blur-xl transition-all duration-500 pointer-events-none" />

        <div className="relative flex items-center">
          <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none z-10">
            <Search className={`transition-colors duration-300 ${isSearching ? 'text-[var(--color-neon-yellow)] animate-spin' : isFocused ? 'text-white' : 'text-slate-400 group-hover:text-white'}`} size={24} />
          </div>

          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={onChange}
            onFocus={() => { setIsFocused(true); onFocus(); }}
            onBlur={() => { setTimeout(() => setIsFocused(false), 200); onBlur(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) {
                saveToHistory(value.trim());
              }
            }}
            placeholder={source === 'all' ? 'Search YouTube, SoundCloud & Spotify...' : `Search on ${source.charAt(0).toUpperCase() + source.slice(1)}...`}
            className="w-full bg-zinc-950/80 backdrop-blur-3xl border border-white/15 shadow-[inset_0_1px_2px_rgba(255,255,255,0.1),0_20px_50px_rgba(0,0,0,0.9)] rounded-2xl py-5 pl-16 pr-28 text-lg md:text-xl text-white placeholder-slate-400 focus:outline-none focus:border-[var(--color-neon-yellow)]/60 focus:ring-2 focus:ring-[var(--color-neon-yellow)]/30 transition-all duration-300"
          />

          <div className="absolute inset-y-0 right-5 flex items-center gap-2">
            {value ? (
              <button
                onClick={() => onChange({ target: { value: '' } } as any)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all"
                title="Clear search"
              >
                <X size={16} />
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 border border-white/10 text-[10px] font-bold text-slate-400 tracking-wider">
                CTRL K
              </kbd>
            )}
          </div>
        </div>

        {/* Search History & Suggestions Popup */}
        <AnimatePresence>
          {isFocused && !value && searchHistory.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              className="absolute left-0 right-0 top-full mt-2 z-50 p-4 rounded-2xl glass-panel border border-white/15 bg-zinc-900/95 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)]"
            >
              <div className="flex items-center justify-between px-2 mb-3">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <History size={14} className="text-[var(--color-neon-yellow)]" /> Recent Searches
                </span>
                <button
                  onClick={() => {
                    setSearchHistory([]);
                    localStorage.removeItem('muziso_search_history');
                  }}
                  className="text-[11px] font-semibold text-slate-500 hover:text-rose-400 transition-colors"
                >
                  Clear All
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {searchHistory.map((query) => (
                  <div
                    key={query}
                    onClick={() => {
                      onChange({ target: { value: query } } as any);
                      if (onSelectVariety) onSelectVariety(query);
                    }}
                    className="group flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-medium text-slate-200 hover:text-white cursor-pointer transition-all"
                  >
                    <span>{query}</span>
                    <button
                      onClick={(e) => removeFromHistory(query, e)}
                      className="opacity-50 group-hover:opacity-100 hover:text-rose-400 transition-all p-0.5"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Source Selector Filter Pills */}
      <motion.div layout className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => onSourceChange('all')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all border ${source === 'all'
            ? 'bg-gradient-to-b from-white via-slate-100 to-slate-300 border-white text-black shadow-[0_4px_25px_rgba(255,255,255,0.35)] scale-105'
            : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white'}`}
        >
          <Sparkles size={15} className={source === 'all' ? 'text-black' : 'text-slate-400'} />
          <span>All Sources</span>
        </button>

        {Object.entries(activeSources).filter(([_, isActive]) => isActive).map(([s, _]) => {
          const isSelected = source === s;

          return (
            <button
              key={s}
              onClick={() => onSourceChange(s as any)}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all border capitalize ${isSelected
                ? s === 'youtube'
                  ? 'bg-gradient-to-r from-red-600 to-rose-600 border-red-400 text-white shadow-[0_4px_25px_rgba(239,68,68,0.5)] scale-105'
                  : s === 'soundcloud'
                    ? 'bg-gradient-to-r from-amber-500 to-orange-600 border-amber-400 text-white shadow-[0_4px_25px_rgba(245,158,11,0.5)] scale-105'
                    : 'bg-gradient-to-r from-emerald-500 to-green-600 border-emerald-400 text-white shadow-[0_4px_25px_rgba(16,185,129,0.5)] scale-105'
                : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white'}`}
            >
              {s === 'youtube' && <Flame size={15} />}
              {s === 'soundcloud' && <Radio size={15} />}
              {s === 'spotify' && <Disc size={15} />}
              <span>{s}</span>
            </button>
          );
        })}
      </motion.div>

      {/* Quick Variety / Mood & Genre Discovery Chips */}
      {!value && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-3 pt-3"
        >
          <p className="text-xs font-bold text-slate-400 tracking-widest uppercase opacity-70">
            Quick Variety Search
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 max-w-3xl">
            {varietyTags.map((tag) => (
              <motion.button
                key={tag.label}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  if (onSelectVariety) onSelectVariety(tag.label);
                  saveToHistory(tag.label);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 hover:border-white/30 text-xs font-extrabold text-slate-200 hover:text-white transition-all shadow-md hover:shadow-lg"
              >
                {tag.icon}
                <span>{tag.label}</span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}


function QuickPlayCard({ track, onPlay, isPlaying, isCurrentTrack, onContextMenu }: { track: any, onPlay: () => void, isPlaying: boolean, isCurrentTrack: boolean, onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <motion.div
      whileHover={{ scale: 1.03, y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={onPlay}
      onContextMenu={onContextMenu}
      className={`group relative flex flex-col cursor-pointer rounded-xl overflow-hidden bg-slate-900/40 hover:bg-slate-900/70 border transition-all duration-200 shadow-md
        ${isCurrentTrack ? 'border-violet-500/40 shadow-[0_0_16px_rgba(139,92,246,0.2)]' : 'border-white/5 hover:border-white/15'}`}
    >
      {/* Square artwork */}
      <div className="relative aspect-square w-full bg-slate-900 overflow-hidden">
        <img
          src={track.artwork_url || `https://picsum.photos/seed/${encodeURIComponent(track.title)}/200`}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          alt={track.title}
        />
        {/* Play / Pause overlay */}
        <div className={`absolute inset-0 bg-slate-950/50 flex items-center justify-center transition-opacity duration-200
          ${isCurrentTrack && isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-xl transition-transform duration-200 group-hover:scale-110"
            style={{ background: 'linear-gradient(135deg, var(--theme-accent, #8b5cf6), #06b6d4)' }}>
            {isCurrentTrack && isPlaying
              ? <Pause size={18} fill="white" className="text-white" />
              : <Play size={18} fill="white" className="text-white ml-0.5" />}
          </div>
        </div>
        {/* Active equalizer indicator */}
        {isCurrentTrack && isPlaying && (
          <div className="absolute bottom-1.5 left-1.5 flex items-end gap-0.5">
            <span className="w-0.5 h-2 rounded-full bg-violet-400 eq-bar-1" />
            <span className="w-0.5 h-3 rounded-full bg-cyan-400 eq-bar-2" />
            <span className="w-0.5 h-1.5 rounded-full bg-violet-400 eq-bar-3" />
          </div>
        )}
      </div>

      {/* Title + artist below artwork */}
      <div className="px-2.5 py-2 min-w-0">
        <p className={`text-xs font-bold truncate leading-tight ${isCurrentTrack ? 'text-violet-400' : 'text-white'}`}>
          {stripExtension(track.title)}
        </p>
        {track.artist && (
          <p className="text-[10px] text-slate-400 truncate mt-0.5 leading-tight">{track.artist}</p>
        )}
      </div>
    </motion.div>
  );
}


function TrackResult({ track, onPlay, currentTrackId, isCurrentlyPlaying, onContextMenu }: { track: AggregatedTrack; onPlay: (track: AggregatedTrack) => void; currentTrackId: string | null; isCurrentlyPlaying: boolean; onContextMenu?: (e: React.MouseEvent) => void }) {
  const isCurrentTrack = currentTrackId === track.id;

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPlay(track);
  };



  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={handlePlay}
      onContextMenu={onContextMenu}
      className={`group flex items-center gap-4 p-3 rounded-2xl bg-zinc-900/20 hover:bg-white/5 border transition-all cursor-pointer relative
                  ${isCurrentTrack ? 'border-[var(--color-neon-yellow)]/50 bg-white/5' : 'border-transparent hover:border-white/10'}`}
    >
      <div className="w-16 h-16 rounded-2xl overflow-hidden shrink-0 relative bg-zinc-800">
        <img src={track.artwork_url} className="w-full h-full object-cover" alt={track.title} />
      </div>
      <div className="flex-1 truncate">
        <h4 className={`font-black truncate ${isCurrentTrack ? 'text-[var(--color-neon-yellow)]' : 'text-white'}`}>{stripExtension(track.title)}</h4>
        <p className="text-xs text-white/50 tracking-wide font-medium truncate">{track.artist}</p>
      </div>

      {/* Hover Actions */}
      <div className="absolute right-3 inset-y-0 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handlePlay}
          className="bg-[var(--color-neon-yellow)] text-black font-bold px-4 py-2 rounded-xl text-sm shadow-lg hover:scale-105 active:scale-95 transition-all text-sm"
        >
          {isCurrentTrack && isCurrentlyPlaying ? 'Playing' : 'Play'}
        </button>
        <button className="p-2 backdrop-blur-md bg-white/10 rounded-xl border border-white/20 hover:bg-white/20 transition-all">
          <ListMusic size={18} />
        </button>
      </div>
    </motion.div>
  );
}

function SkeletonTrack() {
  return (
    <div className="flex items-center gap-4 p-3 rounded-2xl bg-white/5 animate-pulse">
      <div className="w-16 h-16 rounded-2xl bg-white/10" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-white/10 rounded w-3/4" />
        <div className="h-3 bg-white/10 rounded w-1/2" />
      </div>
    </div>
  );
}

function PlaylistCard({
  playlist,
  username,
  onClick,
  onPlayPlaylist,
  onDeletePlaylist,
  isPlayingPlaylist
}: {
  playlist: any;
  username: string;
  onClick: () => void;
  onPlayPlaylist: () => void;
  onDeletePlaylist: () => void;
  isPlayingPlaylist: boolean;
}) {
  const showGrid = playlist.tracks && playlist.tracks.length >= 4;
  const gridImages = showGrid ? playlist.tracks.slice(0, 4).map((t: any) => t.artwork_url || t.artworkUrl) : [];

  return (
    <motion.div
      whileHover={{ y: -6, scale: 1.01 }}
      onClick={onClick}
      className="group cursor-pointer flex flex-col gap-3 p-3 rounded-2xl bg-transparent hover:bg-white/10 border border-transparent transition-all duration-300 relative"
    >
      <div className="aspect-square rounded-xl bg-zinc-900 overflow-hidden relative border border-white/5 shadow-md">
        {showGrid ? (
          <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
            {gridImages.map((src: string, idx: number) => (
              <div key={idx} className="w-full h-full bg-zinc-800 overflow-hidden relative">
                {src ? (
                  <img src={src} className="w-full h-full object-cover" alt="" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-700">
                    <Music size={12} className="text-zinc-500" />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : playlist.artwork_url ? (
          <img
            src={playlist.artwork_url}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
            alt=""
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-800">
            <ListMusic size={32} className="text-zinc-500" />
          </div>
        )}

        {/* Hover play overlay */}
        <div className={`absolute inset-0 bg-black/40 transition-all duration-300 flex items-center justify-center backdrop-blur-[2px] opacity-0 group-hover:opacity-100 ${isPlayingPlaylist ? 'opacity-100' : ''}`}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlayPlaylist();
            }}
            className="w-12 h-12 bg-[#ccff00] shadow-[0_0_20px_rgba(204,255,0,0.5)] rounded-full flex items-center justify-center border border-white/20 hover:scale-105 active:scale-95 transition-all"
          >
            {isPlayingPlaylist ? (
              <div className="flex gap-0.5 items-center justify-center h-4">
                <div className="w-0.75 h-2 bg-black animate-pulse" />
                <div className="w-0.75 h-4 bg-black animate-pulse" style={{ animationDelay: '100ms' }} />
                <div className="w-0.75 h-1.5 bg-black animate-pulse" style={{ animationDelay: '200ms' }} />
              </div>
            ) : (
              <Play size={18} fill="black" className="text-black ml-0.5" />
            )}
          </button>
        </div>

        {/* Hover delete button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeletePlaylist();
          }}
          className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-red-600/90 text-white opacity-0 group-hover:opacity-100 transition-all shadow-md z-10"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="px-0.5 min-w-0">
        <h3 className="font-extrabold text-sm text-white truncate group-hover:text-[#ccff00] transition-colors">{playlist.name}</h3>
        <p className="text-xs text-neutral-400 mt-0.5 truncate font-semibold">Playlist • {username}</p>
      </div>
    </motion.div>
  );
}

function AlbumCard({ index, title, artist, onClick, isPlaying, artworkUrl, source, onContextMenu }: { index: number; title: string; artist: string; onClick: () => void; isPlaying: boolean; artworkUrl?: string; source?: string; onContextMenu?: (e: React.MouseEvent) => void }) {
  const [imgUrl, setImgUrl] = useState<string | null>(artworkUrl || null);

  useEffect(() => {
    if (artworkUrl) {
      setImgUrl(artworkUrl);
      return;
    }
    fetchAlbumArt(title, artist).then((url) => {
      if (url) setImgUrl(url);
    });
  }, [title, artist, artworkUrl]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: Math.min(index * 0.02, 0.5), type: "spring", stiffness: 300, damping: 25 }}
      whileHover={{ y: -8, scale: 1.02 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="group cursor-pointer flex flex-col gap-3 p-3 rounded-2xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-white/10 hover:border-white/30 transition-all duration-300 shadow-[0_10px_30px_rgba(0,0,0,0.5)] hover:shadow-[0_15px_40px_rgba(255,255,255,0.1)]"
    >
      <div className="aspect-square rounded-xl bg-zinc-900 overflow-hidden relative border border-white/10 shadow-xl">
        {imgUrl ? (
          <img src={imgUrl} className="w-full h-full object-cover group-hover:scale-108 transition-transform duration-700 ease-out" onError={() => setImgUrl(null)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-800">
            <img src={logoImg} alt="Muziso" className="w-12 h-12 object-contain opacity-30 brightness-120" />
          </div>
        )}
        <div className={`absolute inset-0 bg-black/60 transition-all duration-300 flex items-center justify-center backdrop-blur-[2px] ${isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <div className="w-12 h-12 bg-white text-black shadow-[0_0_25px_rgba(255,255,255,0.5)] rounded-full flex items-center justify-center border border-white group-hover:scale-110 transition-transform">
            {isPlaying ? (
              <div className="flex gap-1 items-center justify-center h-4">
                <div className="w-1 h-3 bg-black animate-pulse" style={{ animationDelay: '0ms' }} />
                <div className="w-1 h-4 bg-black animate-pulse" style={{ animationDelay: '150ms' }} />
                <div className="w-1 h-2.5 bg-black animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
            ) : (
              <Play size={20} fill="black" className="text-black ml-0.5" />
            )}
          </div>
        </div>
      </div>
      <div className="px-1">
        <h3 className={`font-display font-black tracking-tight truncate text-base text-white ${isPlaying ? 'text-[#ccff00] drop-shadow-[0_0_10px_rgba(204,255,0,0.4)]' : 'group-hover:text-[#ccff00] transition-colors'}`}>{stripExtension(title)}</h3>
        <p className="text-xs text-slate-400 truncate font-semibold mt-0.5">{artist}</p>
      </div>
    </motion.div>
  );
}


function MusicNews({ onSelect, onStreamTrack, viewMode, setViewMode, likedTracks, userProfile, news, playlists, loading, onPlayPlaylist }: { onSelect: (track: NewsTrack) => void, onStreamTrack?: (track: any) => void, viewMode: 'grid' | 'list', setViewMode: (mode: 'grid' | 'list') => void, likedTracks?: any[], userProfile?: UserProfile, news: NewsTrack[], playlists?: NewsPlaylist[], loading: boolean, onPlayPlaylist?: (playlist: NewsPlaylist) => void }) {
  const [recentPlays, setRecentPlays] = useState<any[]>([]);
  // Load recent plays from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('muziso_recent_plays');
      if (saved) setRecentPlays(JSON.parse(saved));
    } catch (e) { }
  }, []);

  // Greeting time of day & circadian mix
  const { greeting } = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return { greeting: "Good Morning" };
    if (hour < 18) return { greeting: "Good Afternoon" };
    return { greeting: "Good Evening" };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-4xl md:text-5xl font-display font-black text-white tracking-tighter leading-none">Trending & New Releases</h1>
        <div className={viewMode === 'grid' ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6" : "flex flex-col gap-3"}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => <SkeletonTrack key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col gap-10 pb-32"
    >
      {/* Personalized Header Banner */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-display font-black text-white tracking-tighter leading-none">
            {greeting}, {userProfile?.name ? userProfile.name.split(' ')[0] : 'Listener'}
          </h1>
          <p className="text-slate-400 mt-2 text-sm font-medium">
            Custom recommendations tuned to your real-time listening habits.
          </p>
        </div>
        <ViewToggle viewMode={viewMode} onChange={setViewMode} />
      </div>

      {/* Section 1: "Jump Back In" (Recently Played) */}
      {recentPlays.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <History size={20} className="text-[var(--color-neon-yellow)]" /> Jump Back In
            </h2>
            <span className="text-xs text-slate-400 font-semibold">{recentPlays.length} Recent Tracks</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {recentPlays.slice(0, 5).map((track, i) => (
              <motion.div
                key={track.id + i}
                whileHover={{ y: -4 }}
                onClick={() => onStreamTrack && onStreamTrack(track)}
                className="group cursor-pointer glass-panel p-3 rounded-2xl border border-white/10 hover:border-white/20 transition-all flex flex-col gap-2.5 relative"
              >
                <div className="aspect-square rounded-xl overflow-hidden relative bg-zinc-800 shadow-md">
                  <img src={track.artwork_url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt={track.title} />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-[var(--color-neon-yellow)] text-black flex items-center justify-center shadow-lg">
                      <Play size={18} fill="currentColor" className="ml-0.5" />
                    </div>
                  </div>
                </div>
                <div className="px-0.5">
                  <h4 className="font-bold text-sm text-white truncate group-hover:text-[var(--color-neon-yellow)] transition-colors">{track.title}</h4>
                  <p className="text-xs text-slate-400 truncate">{track.artist}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Section 3: "Global New Releases & Trending" */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Flame size={20} className="text-rose-500" /> Trending & New Releases
          </h2>
        </div>

        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
            {news.map((track, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.02, type: "spring", stiffness: 300, damping: 25 }}
                whileHover={{ y: -6 }}
                onClick={() => onSelect(track)}
                className="group cursor-pointer flex flex-col gap-3"
              >
                <div className="aspect-square rounded-2xl md:rounded-[2rem] bg-zinc-800/30 overflow-hidden relative border border-white/10 transition-all duration-300 shadow-xl group-hover:shadow-2xl group-hover:border-white/20 group-hover:scale-105">
                  <img src={track.artwork_url} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt={track.title} />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                    <div className="bg-[var(--color-neon-yellow)] text-black font-black px-6 py-2.5 rounded-2xl text-xs uppercase tracking-widest shadow-2xl scale-90 group-hover:scale-100 transition-transform">
                      Play Mix
                    </div>
                  </div>
                </div>
                <div className="px-1">
                  <h3 className="font-display font-bold tracking-tight truncate text-base md:text-lg text-white group-hover:text-[var(--color-neon-yellow)] transition-colors">{track.title}</h3>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-xs md:text-sm text-neutral-400 truncate font-sans font-medium">{track.artist}</p>
                    <p className="text-[11px] text-[var(--color-neon-yellow)] font-black uppercase tracking-widest opacity-90 drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]">{track.release_date}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {news.map((track, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.01 }}
                onClick={() => onSelect(track)}
                className="group flex items-center gap-4 p-3 rounded-2xl bg-zinc-900/20 hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-pointer relative"
              >
                <div className="w-16 h-16 rounded-2xl overflow-hidden shrink-0 relative bg-zinc-800">
                  <img src={track.artwork_url} className="w-full h-full object-cover" alt={track.title} />
                </div>
                <div className="flex-1 truncate">
                  <h4 className="font-black text-white truncate group-hover:text-[var(--color-neon-yellow)] transition-colors">{track.title}</h4>
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-white/50 tracking-wide font-medium">{track.artist}</p>
                    <span className="w-1 h-1 rounded-full bg-white/20" />
                    <p className="text-[10px] text-[var(--color-neon-yellow)] font-bold uppercase tracking-widest">{track.release_date}</p>
                  </div>
                </div>
                <div className="bg-[var(--color-neon-yellow)] text-black font-black px-4 py-2 rounded-xl text-[10px] uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                  Play
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Section 4: Trending Playlists */}
      {playlists && playlists.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <ListMusic size={20} className="text-violet-400" /> Trending Playlists
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
            {playlists.map((pl, i) => (
              <motion.div
                key={pl.id || i}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.03, type: "spring", stiffness: 300, damping: 25 }}
                whileHover={{ y: -6 }}
                onClick={() => onPlayPlaylist?.(pl)}
                className="group cursor-pointer flex flex-col gap-3"
              >
                <div className="aspect-square rounded-2xl md:rounded-[2rem] bg-zinc-800/30 overflow-hidden relative border border-white/10 transition-all duration-300 shadow-xl group-hover:shadow-2xl group-hover:border-violet-500/40 group-hover:scale-105">
                  <img src={pl.artwork_url} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt={pl.title} />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 backdrop-blur-[2px]">
                    <div className="w-14 h-14 bg-violet-500 shadow-[0_0_25px_rgba(139,92,246,0.6)] rounded-full flex items-center justify-center border border-white/20">
                      <ListMusic size={20} className="text-white" />
                    </div>
                    <span className="text-white font-black text-[10px] uppercase tracking-widest">Open Playlist</span>
                  </div>
                  <div className="absolute top-2 right-2 bg-violet-600/90 backdrop-blur-sm text-white text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full">
                    {pl.type === 'album' ? 'Album' : 'Playlist'}
                  </div>
                </div>
                <div className="px-1">
                  <h3 className="font-display font-bold tracking-tight truncate text-base md:text-lg text-white group-hover:text-violet-400 transition-colors">{pl.title}</h3>
                  <p className="text-xs md:text-sm text-neutral-400 truncate font-sans font-medium">{pl.subtitle}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default App;
