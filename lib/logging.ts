// Deliberately accept only operational fields. Never pass Error/SDK objects,
// request headers, bodies, video titles, session IDs or URLs to this logger.
type LogFields = {
  requestId?: string; method?: string; path?: string; status?: number;
  code?: string; complete?: boolean; durationMs?: number; port?: number;
  hostname?: string; node?: string; stage?: string; playability?: string;
  formats?: number; audioCandidates?: number; videoCandidates?: number;
};
let context: () => { requestId?: string } = () => ({});
export function setLogContext(provider: typeof context) { context = provider; }

export function logEvent(event: string, fields: LogFields = {}) {
  console.info(JSON.stringify({ time: new Date().toISOString(), event, ...context(), ...fields }));
}
