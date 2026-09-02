/**
 * The smallest real thing routes/admin-health.js can report on the API
 * itself: an in-memory ring buffer of recent request timings, nothing
 * persisted, nothing bucketed to disk. No metrics service, no timeseries
 * store — building one is exactly the "monitoring infrastructure" this
 * phase's own task was told not to overbuild for a frontend that mostly
 * needs "is it slow, is it erroring, how long has it been up."
 *
 * Because nothing survives a restart, `SERVER_START` is also the honest
 * beginning of the only window this can ever speak to — see
 * `observedHours()` and admin-health.js's own note on `uptime30d`.
 */

export const SERVER_START = Date.now();

const CAPACITY = 5_000;

/** A fixed-size ring: old samples fall off rather than growing forever. */
const samples = [];
let cursor = 0;

export function requestMetrics(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const sample = { at: Date.now(), durationMs, ok: res.statusCode < 500 };
    if (samples.length < CAPACITY) {
      samples.push(sample);
    } else {
      samples[cursor] = sample;
      cursor = (cursor + 1) % CAPACITY;
    }
  });
  next();
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return Math.round(sorted[index]);
}

/** Real hours observed since this process started — never fabricated history. */
export function observedHours(now = Date.now()) {
  return (now - SERVER_START) / (60 * 60 * 1000);
}

/**
 * Live figures over every sample currently held (bounded by `CAPACITY`, or
 * by how long the process has actually been up if that's shorter — there is
 * no per-hour bucketing here, deliberately: with a process this young in any
 * dev/test run, an hourly series would mostly be empty buckets dressed up as
 * a trend. `latencySeries`/`requestSeries` are left for the frontend's own
 * "not enough data yet" state (`ENOUGH_HOURS`) to handle honestly, rather
 * than this route inventing a shape for hours that were never observed.
 */
export function snapshot() {
  const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b);
  const errors = samples.filter((s) => !s.ok).length;

  return {
    latencyP50: percentile(durations, 0.5),
    latencyP95: percentile(durations, 0.95),
    errorRate: samples.length === 0 ? 0 : errors / samples.length,
    sampleCount: samples.length,
  };
}
