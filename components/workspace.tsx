"use client";

/* eslint-disable @next/next/no-img-element -- Thumbnails are authenticated, same-origin resources. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowDownLeft, ArrowRight, AudioLines, Check, ChevronDown, Copy, Eye, EyeOff, Headphones, History, Link2, LoaderCircle, LockKeyhole, Play, Radio, RotateCw, ShieldCheck, Trash2, X } from "lucide-react";
import DashPlayer from "@/components/dash-player";
import { HISTORY_KEY, parseHistory } from "@/lib/history";
import { formatDuration, parseVideoId } from "@/lib/video-id";
import type { ApiErrorBody, HistoryItem, PlaybackMode, PlaybackSource, VideoQuality } from "@/lib/types";

const HISTORY_EVENT = "relay:history-change";
const EMPTY_HISTORY: HistoryItem[] = [];
function subscribeHistory(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(HISTORY_EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(HISTORY_EVENT, callback); };
}
function historySnapshot() {
  try { return localStorage.getItem(HISTORY_KEY) ?? ""; } catch { return ""; }
}
function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event(HISTORY_EVENT));
    return true;
  } catch { return false; }
}

function Brand() {
  return <div className="brand" aria-label="relay"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>relay<span className="brand-dot">.</span></span></div>;
}
function Record({ loading = false }: { loading?: boolean }) {
  return <div className={`record ${loading ? "record-loading" : ""}`} aria-hidden="true"><span className="record-inner">{loading ? <LoaderCircle size={26} className="spin" /> : <Play size={24} strokeWidth={1.5} />}</span></div>;
}

export default function Workspace({ initialAuthenticated, configured }: { initialAuthenticated: boolean; configured: boolean }) {
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [password, setPassword] = useState("");
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<PlaybackMode>("video");
  const [quality, setQuality] = useState<VideoQuality>(360);
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [playbackError, setPlaybackError] = useState("");
  const [playState, setPlayState] = useState<"ready" | "playing" | "buffering" | "paused" | "ended">("ready");
  const [resumeTime, setResumeTime] = useState(0);
  const [toast, setToast] = useState("");
  const snapshot = useSyncExternalStore(subscribeHistory, historySnapshot, () => "");
  const history = useMemo(() => snapshot ? parseHistory(snapshot) : EMPTY_HISTORY, [snapshot]);
  const controller = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<HTMLElement | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true); setAuthError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const data = await response.json() as ApiErrorBody;
        setAuthError(data.error.message);
        return;
      }
      setAuthenticated(true); setPassword("");
    } catch { setAuthError("Không kết nối được server. Hãy thử lại."); }
    finally { setAuthBusy(false); }
  }

  async function lock() {
    setAuthBusy(true);
    try {
      const response = await fetch("/api/auth", { method: "DELETE", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Logout failed");
      controller.current?.abort();
      setSource(null); setAuthenticated(false); setFormError(""); setPlaybackError(""); setLoading(false);
    } catch { setToast("Chưa khóa được phiên. Hãy kiểm tra kết nối và thử lại."); }
    finally { setAuthBusy(false); }
  }

  async function openVideo(value = input, nextMode = mode, nextQuality = quality, at = 0) {
    let id: string;
    try { id = parseVideoId(value); }
    catch (error) { setFormError(error instanceof Error ? error.message : "Link không hợp lệ."); urlRef.current?.focus(); return; }
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setLoading(true); setSource(null); setFormError(""); setPlaybackError(""); setResumeTime(at); setPlayState("ready");
    setInput(value); setMode(nextMode); setQuality(nextQuality);
    try {
      const response = await fetch("/api/video", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: id, mode: nextMode, quality: nextQuality }),
        signal: AbortSignal.any([active.signal, AbortSignal.timeout(110000)]),
      });
      const data = await response.json() as PlaybackSource | ApiErrorBody;
      if (active.signal.aborted) return;
      if (!response.ok) {
        const message = "error" in data ? data.error.message : "Không lấy được luồng.";
        if (response.status === 401) { setAuthenticated(false); setAuthError(message); }
        else setFormError(message);
        return;
      }
      setSource(data as PlaybackSource);
    } catch (error) {
      if (!active.signal.aborted) setFormError(error instanceof Error && error.name === "TimeoutError" ? "Server phản hồi quá lâu. Hãy thử lại." : "Không kết nối được server. Hãy thử lại.");
    } finally {
      if (controller.current === active) setLoading(false);
    }
  }

  const onReady = useCallback(() => setPlayState("ready"), []);
  const onWaiting = useCallback(() => setPlayState("buffering"), []);
  const onPause = useCallback(() => setPlayState("paused"), []);
  const onEnded = useCallback(() => setPlayState("ended"), []);
  const onFailure = useCallback((message: string) => setPlaybackError(message), []);
  const onPlaying = useCallback(() => {
    setPlayState("playing"); setPlaybackError("");
    if (!source) return;
    const item: HistoryItem = { id: source.id, title: source.title, author: source.author, duration: source.duration, thumbnail: source.thumbnail, playedAt: Date.now() };
    const current = parseHistory(historySnapshot());
    if (!saveHistory([item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 12))) setToast("Trình duyệt không cho phép lưu lịch sử.");
  }, [source]);

  async function copyLink() {
    if (!source) return;
    try { await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${source.id}`); setToast("Đã sao chép link YouTube."); }
    catch { setToast("Trình duyệt không cho phép sao chép. Bạn có thể copy link trong ô nhập."); }
  }

  function clearHistory() {
    if (saveHistory([])) setToast("Đã xóa lịch sử trên trình duyệt này.");
    else setToast("Trình duyệt không cho phép xóa lịch sử.");
  }

  const statusText = loading ? "Đang lấy luồng" : playbackError ? "Luồng gián đoạn" : source ? playState === "playing" ? "Đang phát" : playState === "buffering" ? "Đang tải đoạn" : playState === "paused" ? "Đã tạm dừng" : playState === "ended" ? "Đã phát xong" : "Sẵn sàng" : formError ? "Chưa phát được" : "Chờ một link";

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Đi tới nội dung chính</a>
    <header className="app-header">
      <Brand />
      <span className="header-caption">KHÔNG GIAN PHÁT RIÊNG</span>
      <div className="header-actions">
        <span className="private-label"><span className="quiet-dot" />Cá nhân</span>
        {authenticated ? <button className="lock-button" onClick={() => void lock()} disabled={authBusy}><LockKeyhole size={15} />Khóa</button> : <span className="session-label"><LockKeyhole size={14} />Phiên riêng tư</span>}
      </div>
    </header>

    {!authenticated ? <main id="main-content" className="gate-layout">
      <section className="gate-intro">
        <span className="eyebrow">PERSONAL EDITION — 01</span>
        <h1>Một nơi<br />để bấm <span>play.</span></h1>
        <p className="gate-description">Dán một link YouTube để xem hoặc chỉ nghe.<br className="desktop-break" /> Luồng media đi qua server của bạn.</p>
        <div className="gate-visual" aria-hidden="true"><Record /><span className="gate-visual-line" /><span className="gate-visual-caption">PRESS PLAY. MAKE SPACE.</span></div>
        <div className="experimental-note"><Radio size={16} /><span>Bản thử nghiệm trên Vercel.<br />Không đảm bảo phát được mọi video.</span></div>
      </section>
      <section className="gate-panel" aria-labelledby="gate-title">
        <div className="panel-index"><span>01 / MỞ KHÓA</span><LockKeyhole size={18} /></div>
        <h2 id="gate-title">Vào không gian riêng</h2>
        <p>Nhập mật khẩu bạn đã đặt trên server.<br />Không cần tài khoản Google.</p>
        <form onSubmit={(event) => void unlock(event)}>
          <label htmlFor="access-password">Mật khẩu truy cập</label>
          <div className="password-field">
            <input id="access-password" type={visiblePassword ? "text" : "password"} autoComplete="current-password" required maxLength={512} value={password} onChange={(event) => setPassword(event.target.value)} disabled={!configured || authBusy} placeholder="Nhập mật khẩu của bạn" aria-describedby={authError ? "auth-error" : undefined} />
            <button type="button" className="icon-button" onClick={() => setVisiblePassword(!visiblePassword)} aria-label={visiblePassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={visiblePassword}>{visiblePassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div>
          {authError && <p id="auth-error" className="field-error" role="alert">{authError}</p>}
          {!configured && <div className="configuration-note" role="status">Kiểm tra cấu hình server: <code>ACCESS_PASSWORD</code> không được để trống và <code>AUTH_SECRET</code> cần ít nhất 32 ký tự. Sửa trong <code>.env.local</code> rồi khởi động lại server, hoặc đặt các biến trên Vercel.</div>}
          <button className="primary-button unlock-button" disabled={!configured || authBusy}>{authBusy ? <><LoaderCircle size={17} className="spin" />Đang mở khóa</> : <>Mở khóa<ArrowRight size={18} /></>}</button>
        </form>
        <div className="gate-security"><ShieldCheck size={16} /><span>Phiên có thời hạn 8 giờ.<br />Mật khẩu không được lưu trên trình duyệt.</span></div>
      </section>
    </main> : <div className="workspace-layout">
      <nav className="workspace-nav" aria-label="Điều hướng">
        <div><span className="nav-label">THƯ VIỆN CỦA BẠN</span>
          <button className="nav-item nav-active" onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); urlRef.current?.focus(); }} aria-current="page"><Play size={17} />Trình phát<span className="nav-tick" /></button>
          <button className="nav-item" onClick={() => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}><History size={17} />Đã mở<span className="nav-count">{history.length}</span></button>
        </div>
        <div className="nav-bottom"><ShieldCheck size={20} /><p>Lịch sử chỉ lưu<br />trên trình duyệt này.</p><span>PRIVATE / LOCAL HISTORY</span></div>
      </nav>
      <main id="main-content" className="workspace-body">
        <div className="section-heading"><div><span className="eyebrow">BÀN PHÁT / 01</span><h1>Hôm nay, {mode === "audio" ? "nghe" : "xem"} gì?</h1></div><span className="edition-label">YOUTUBE<br /><span>EXPERIMENTAL</span></span></div>
        <div className="workspace-content">
          <section className="playback-column" aria-label="Trình phát YouTube">
            <form className="link-form" onSubmit={(event) => { event.preventDefault(); void openVideo(); }}>
              <label className="input-label" htmlFor="youtube-url">LINK YOUTUBE</label>
              <div className="link-entry"><Link2 size={19} className="input-icon" /><input ref={urlRef} id="youtube-url" type="text" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={2048} placeholder="Dán link YouTube tại đây…" value={input} onChange={(event) => { setInput(event.target.value); setFormError(""); }} /><button className="primary-button play-button" disabled={loading}>{loading ? <LoaderCircle size={17} className="spin" /> : <Play size={15} />}<span>{loading ? "Đang lấy" : "Phát"}</span></button></div>
              <div className="playback-options">
                <fieldset className="mode-switch"><legend className="sr-only">Chế độ phát</legend>
                  <label className={mode === "video" ? "mode-selected" : ""}><input type="radio" name="mode" value="video" checked={mode === "video"} onChange={() => { setMode("video"); if (source) void openVideo(source.id, "video", quality, videoRef.current?.currentTime ?? 0); }} disabled={loading} /><Play size={14} />Xem video</label>
                  <label className={mode === "audio" ? "mode-selected" : ""}><input type="radio" name="mode" value="audio" checked={mode === "audio"} onChange={() => { setMode("audio"); if (source) void openVideo(source.id, "audio", quality, videoRef.current?.currentTime ?? 0); }} disabled={loading} /><Headphones size={15} />Chỉ nghe</label>
                </fieldset>
                <div className="quality-option"><label htmlFor="quality">Chất lượng</label><div className="select-wrap"><select id="quality" value={quality} disabled={mode === "audio" || loading} onChange={(event) => { const next = Number(event.target.value) as VideoQuality; setQuality(next); if (source) void openVideo(source.id, mode, next, videoRef.current?.currentTime ?? 0); }}><option value={360}>360p</option><option value={720}>720p</option></select><ChevronDown size={13} aria-hidden="true" /></div></div>
              </div>
            </form>
            {formError && <div className="error-notice" role="alert"><div><span className="error-title">Chưa lấy được luồng</span><p>{formError}</p></div><button className="icon-button" aria-label="Đóng thông báo lỗi" onClick={() => setFormError("")}><X size={17} /></button></div>}
            <div className="player-frame" aria-busy={loading}>
              <div className="player-stage">
                {source ? <DashPlayer source={source} resumeTime={resumeTime} onReady={onReady} onPlaying={onPlaying} onWaiting={onWaiting} onPause={onPause} onEnded={onEnded} onFailure={onFailure} mediaRef={videoRef} /> : <div className="empty-stage"><span className="stage-corner">SIDE A</span><Record loading={loading} /><div className="empty-stage-copy"><h2>{loading ? "Đang nối đường truyền…" : "Link của bạn. Nhịp của bạn."}</h2><p>{loading ? "Lấy thông tin, kiểm tra luồng và chuẩn bị trình phát." : "Dán một link ở trên, phần còn lại để relay thử xử lý."}</p></div><span className="stage-bottom-label">{loading ? "CONNECTING" : "READY WHEN YOU ARE"}<ArrowDownLeft size={14} /></span></div>}
              </div>
              <div className="player-status"><span className={`play-status ${playState === "playing" && source && !playbackError ? "is-playing" : ""}`}>{loading ? <LoaderCircle size={13} className="spin" /> : <span className="status-dot" />}<span role="status" aria-live="polite">{statusText}</span></span><span className="stream-label">{source ? source.quality : "YouTube · Qua server"}<AudioLines size={15} /></span></div>
            </div>
            {playbackError && <div className="error-notice playback-error" role="alert"><div><span className="error-title">Luồng bị gián đoạn</span><p>{playbackError}</p></div></div>}
            {source && <section className="now-playing" aria-label="Nội dung đang mở"><span className="eyebrow">{source.mode === "audio" ? "ĐANG NGHE" : "ĐANG MỞ"}</span><h2>{source.title}</h2><div className="video-meta"><span>{source.author}</span><span className="meta-divider" /><span>{formatDuration(source.duration)}</span></div><div className="video-actions"><button className="text-button" onClick={() => void openVideo(source.id, mode, quality, videoRef.current?.currentTime ?? 0)} disabled={loading}><RotateCw size={14} />Lấy lại luồng</button><button className="text-button" onClick={() => void copyLink()}><Copy size={14} />Copy link</button></div></section>}
            <details className="help-details"><summary>Vì sao có video không phát được?<ChevronDown size={15} /></summary><div><p>YouTube có thể chặn IP datacenter, yêu cầu xác minh hoặc thay đổi player. Bản này không hỗ trợ livestream, video riêng tư, giới hạn tuổi hay DRM.</p><p>Mỗi đoạn media tối đa 4 MiB. Nếu gặp đoạn quá lớn, thử 360p hoặc chỉ nghe. Sau 2 giờ hoặc khi URL hết hạn, bấm “Lấy lại luồng”.</p><p>Vercel tính lưu lượng cả đầu vào và đầu ra. Theo dõi Usage và Firewall trong dashboard khi triển khai.</p></div></details>
          </section>
          <aside className="history-panel" ref={historyRef} aria-labelledby="history-heading"><div className="history-heading"><div><span className="eyebrow">TRÊN THIẾT BỊ NÀY</span><h2 id="history-heading">Đã mở gần đây<span>{history.length.toString().padStart(2, "0")}</span></h2></div>{history.length > 0 && <button className="icon-button" aria-label="Xóa lịch sử" onClick={clearHistory}><Trash2 size={16} /></button>}</div>
            {history.length ? <ol className="history-list">{history.map((item, index) => <li key={item.id}><button className={`history-item ${source?.id === item.id ? "history-current" : ""}`} onClick={() => void openVideo(item.id)} disabled={loading} aria-label={`Phát lại ${item.title}`}><div className="history-thumbnail"><img src={item.thumbnail} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} /><span className="thumbnail-duration">{formatDuration(item.duration)}</span>{source?.id === item.id && <span className="thumbnail-playing"><AudioLines size={17} /></span>}</div><span className="history-copy"><span className="history-title">{item.title}</span><span className="history-author">{item.author}</span></span><span className="history-index">{String(index + 1).padStart(2, "0")}</span></button></li>)}</ol> : <div className="history-empty"><div className="history-empty-lines" aria-hidden="true"><span /><span /><span /></div><h3>Chưa có video nào.</h3><p>Nội dung đã phát sẽ xuất hiện ở đây.<br />Chỉ bạn, chỉ trên trình duyệt này.</p><button className="text-button sample-button" onClick={() => void openVideo("jNQXAC9IVRw")} disabled={loading}>Thử một video ngắn<ArrowRight size={14} /></button></div>}
            <div className="connection-note"><span className="eyebrow">ĐƯỜNG TRUYỀN</span><div>Trình duyệt<span>→</span>Vercel<span>→</span>YouTube</div><p>Không iframe. Media qua server.<br />Khả năng phát phụ thuộc YouTube.</p></div>
          </aside>
        </div>
      </main>
    </div>}
    <footer className="app-footer"><span>relay / personal player</span><span>Dùng nội dung bạn có quyền truy cập, theo chính sách mạng.</span><span>VERCEL EDITION — 0.1</span></footer>
    {toast && <div className="toast" role="status"><Check size={16} /><span>{toast}</span><button className="icon-button" onClick={() => setToast("")} aria-label="Đóng thông báo"><X size={15} /></button></div>}
  </div>;
}
