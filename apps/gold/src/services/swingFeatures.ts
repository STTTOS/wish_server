/**
 * 正向波段特征：与 london-gold electron/swingRanges 同算法。
 * 从 MySQL Tick 按需聚合 H1 后检测低→高腿。
 */
import { OZ_TO_G } from "../config";
import prisma from "../models";
import { aggregateTicksToHourly, type HourlyBar } from "./hourlyBars";

const HOUR_MS = 60 * 60 * 1000;
/**
 * 与 london-gold electron/swingRanges 保持一致：默认可拆回撤 ≥ 1×minAmp。
 * 半阈值会低于卖费(0.4%)+高低点误差的摩擦成本，拆段净收益为负。
 */
const DEFAULT_PULLBACK_FRAC = 1;

export type SwingRangeLeg = {
  fromTs: number;
  toTs: number;
  lowUsdOz: number;
  highUsdOz: number;
  lowCnyG: number;
  highCnyG: number;
  ampCnyG: number;
};

export type SwingFeaturesReport = {
  hours: number;
  minAmpCnyG: number;
  fx: number | null;
  asOfTs: number;
  tickCount: number;
  barCount: number;
  legs: SwingRangeLeg[];
  maxAmpCnyG: number | null;
  bars: HourlyBar[];
};

function usdToCnyG(usd: number, fx: number): number {
  return (usd * fx) / OZ_TO_G;
}

type Pivot = {
  i: number;
  kind: "low" | "high";
  usd: number;
  cny: number;
  ts: number;
};

function buildPivots(
  bars: HourlyBar[],
  lows: number[],
  highs: number[]
): Pivot[] {
  const raw: Pivot[] = [];
  for (let i = 1; i < bars.length - 1; i++) {
    const isLow = lows[i]! <= lows[i - 1]! && lows[i]! <= lows[i + 1]!;
    const isHigh = highs[i]! >= highs[i - 1]! && highs[i]! >= highs[i + 1]!;
    if (isLow && !isHigh) {
      raw.push({
        i,
        kind: "low",
        usd: bars[i]!.low,
        cny: lows[i]!,
        ts: bars[i]!.ts,
      });
    } else if (isHigh && !isLow) {
      raw.push({
        i,
        kind: "high",
        usd: bars[i]!.high,
        cny: highs[i]!,
        ts: bars[i]!.ts,
      });
    }
  }

  const pivots: Pivot[] = [];
  for (const p of raw) {
    const last = pivots[pivots.length - 1];
    if (!last || last.kind !== p.kind) {
      pivots.push(p);
      continue;
    }
    if (p.kind === "low" && p.cny < last.cny) pivots[pivots.length - 1] = p;
    if (p.kind === "high" && p.cny > last.cny) pivots[pivots.length - 1] = p;
  }
  while (pivots.length > 0 && pivots[0]!.kind !== "low") pivots.shift();
  return pivots;
}

function legFrom(
  bars: HourlyBar[],
  lows: number[],
  highs: number[],
  loI: number,
  hiI: number
): SwingRangeLeg | null {
  if (hiI <= loI) return null;
  const amp = highs[hiI]! - lows[loI]!;
  if (!(amp > 0)) return null;
  return {
    fromTs: bars[loI]!.ts,
    toTs: bars[hiI]!.ts + HOUR_MS - 1,
    lowUsdOz: bars[loI]!.low,
    highUsdOz: bars[hiI]!.high,
    lowCnyG: lows[loI]!,
    highCnyG: highs[hiI]!,
    ampCnyG: amp,
  };
}

function argmaxHigh(
  highs: number[],
  fromI: number,
  toIInclusive: number
): number {
  let hiI = fromI;
  for (let k = fromI + 1; k <= toIInclusive; k++) {
    if (highs[k]! > highs[hiI]!) hiI = k;
  }
  return hiI;
}

type LowChoice = {
  hiI: number;
  amp: number;
  next: number | null;
};

export function detectPositiveSwingRanges(
  bars: HourlyBar[],
  fx: number,
  opts?: { minAmpCnyG?: number; pullbackMinCnyG?: number }
): SwingRangeLeg[] {
  const minAmp = opts?.minAmpCnyG ?? 10;
  const pullbackMin = opts?.pullbackMinCnyG ?? minAmp * DEFAULT_PULLBACK_FRAC;
  if (!(fx > 0) || bars.length < 3 || !(minAmp > 0)) return [];

  const lows = bars.map((b) => usdToCnyG(b.low, fx));
  const highs = bars.map((b) => usdToCnyG(b.high, fx));
  const pivots = buildPivots(bars, lows, highs);
  const lowPivots = pivots.filter((p) => p.kind === "low");
  if (lowPivots.length === 0) return [];

  const n = lowPivots.length;
  const dp = new Array<number>(n).fill(0);
  const choice: Array<LowChoice | null> = new Array(n).fill(null);

  for (let i = n - 1; i >= 0; i--) {
    const loI = lowPivots[i]!.i;
    let best = 0;
    let bestChoice: LowChoice | null = null;

    let mergeEndI = bars.length - 1;
    let deeperJ: number | null = null;
    for (let j = i + 1; j < n; j++) {
      if (lowPivots[j]!.cny < lowPivots[i]!.cny) {
        mergeEndI = lowPivots[j]!.i;
        deeperJ = j;
        break;
      }
    }
    const mergeHi = argmaxHigh(highs, loI, mergeEndI);
    const mergeAmp = highs[mergeHi]! - lows[loI]!;
    if (mergeAmp > minAmp && mergeHi > loI) {
      let next: number | null = deeperJ;
      if (next == null) {
        for (let j = i + 1; j < n; j++) {
          if (lowPivots[j]!.i > mergeHi) {
            next = j;
            break;
          }
        }
      }
      const total = mergeAmp + (next != null ? dp[next]! : 0);
      if (total > best) {
        best = total;
        bestChoice = { hiI: mergeHi, amp: mergeAmp, next };
      }
    }

    for (let j = i + 1; j < n; j++) {
      const loJ = lowPivots[j]!.i;
      if (loJ <= loI + 1) continue;
      const hiI = argmaxHigh(highs, loI, loJ - 1);
      if (hiI <= loI) continue;
      const amp1 = highs[hiI]! - lows[loI]!;
      const pullback = highs[hiI]! - lows[loJ]!;
      if (!(amp1 > minAmp)) continue;
      if (!(pullback >= pullbackMin)) continue;
      const total = amp1 + dp[j]!;
      if (total > best) {
        best = total;
        bestChoice = { hiI, amp: amp1, next: j };
      }
    }

    dp[i] = best;
    choice[i] = bestChoice;
  }

  let start = 0;
  for (let i = 1; i < n; i++) {
    if (dp[i]! > dp[start]!) start = i;
  }
  if (dp[start]! <= 0) return [];

  const legs: SwingRangeLeg[] = [];
  let i: number | null = start;
  const guard = n + 2;
  let steps = 0;
  while (i != null && steps++ < guard) {
    const idx: number = i;
    const ch: LowChoice | null = choice[idx] ?? null;
    if (!ch) break;
    const leg = legFrom(bars, lows, highs, lowPivots[idx]!.i, ch.hiI);
    if (leg && leg.ampCnyG > minAmp) legs.push(leg);
    i = ch.next;
  }

  return legs.sort((a, b) => a.fromTs - b.fromTs);
}

export function clampSwingHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 48;
  return Math.min(168, Math.max(6, Math.floor(hours)));
}

export function clampMinAmpCnyG(v: number): number {
  if (!Number.isFinite(v) || v < 10) return 10;
  return v;
}

/**
 * 从 Tick 表按需计算波段特征。
 */
export async function buildSwingFeatures(opts: {
  hours?: number;
  minAmpCnyG?: number;
  includeBars?: boolean;
  now?: number;
}): Promise<SwingFeaturesReport> {
  const hours = clampSwingHours(opts.hours ?? 48);
  const minAmpCnyG = clampMinAmpCnyG(opts.minAmpCnyG ?? 10);
  const includeBars = Boolean(opts.includeBars);
  const now = opts.now ?? Date.now();
  const since = now - hours * HOUR_MS;

  const rows = await prisma.tick.findMany({
    where: { ts: { gte: BigInt(since), lte: BigInt(now) } },
    orderBy: { ts: "asc" },
    select: { ts: true, usdOz: true, usdCny: true },
  });

  const quotes = rows.map((r) => ({
    ts: Number(r.ts),
    usdOz: r.usdOz,
  }));
  const bars = aggregateTicksToHourly(quotes);

  let fx: number | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i]!.usdCny;
    if (v != null && v > 0) {
      fx = v;
      break;
    }
  }

  const legs =
    fx != null ? detectPositiveSwingRanges(bars, fx, { minAmpCnyG }) : [];
  const maxAmpCnyG =
    legs.length > 0 ? Math.max(...legs.map((l) => l.ampCnyG)) : null;

  return {
    hours,
    minAmpCnyG,
    fx,
    asOfTs: now,
    tickCount: rows.length,
    barCount: bars.length,
    legs,
    maxAmpCnyG,
    bars: includeBars ? bars : [],
  };
}
