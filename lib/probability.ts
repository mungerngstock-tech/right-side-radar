import type { DirectionProbability, MarketBar } from "@/lib/market";

type FeaturePoint = {
  index: number;
  session: string;
  close: number;
  atr: number;
  vwapDistance: number;
  emaSpread: number;
  emaSlope: number;
  relativeVolume: number;
  closeLocation: number;
  momentum: number;
  breakout: boolean;
  green: boolean;
};

type Neighbor = {
  distance: number;
  outcome: number;
  threshold: number;
  session: string;
  recency: number;
};

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sessionFormatter(timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
}

function buildFeatures(bars: MarketBar[], timezone: string) {
  const formatter = sessionFormatter(timezone);
  const features: FeaturePoint[] = [];
  const sessions = bars.map((bar) => formatter.format(bar.time * 1000));

  let activeSession = "";
  let sessionBars: MarketBar[] = [];
  let sessionEma9: number[] = [];
  let volumes: number[] = [];
  let trueRanges: number[] = [];
  let ema9 = 0;
  let ema20 = 0;
  let vwapNumerator = 0;
  let vwapVolume = 0;

  bars.forEach((bar, index) => {
    const session = sessions[index];
    if (session !== activeSession) {
      activeSession = session;
      sessionBars = [];
      sessionEma9 = [];
      volumes = [];
      trueRanges = [];
      ema9 = bar.close;
      ema20 = bar.close;
      vwapNumerator = 0;
      vwapVolume = 0;
    } else {
      ema9 = bar.close * (2 / 10) + ema9 * (1 - 2 / 10);
      ema20 = bar.close * (2 / 21) + ema20 * (1 - 2 / 21);
    }

    const previousClose = sessionBars.at(-1)?.close ?? bar.open;
    const trueRange = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    );
    trueRanges.push(trueRange);
    if (trueRanges.length > 14) trueRanges.shift();

    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    vwapNumerator += typicalPrice * bar.volume;
    vwapVolume += bar.volume;
    const vwap = vwapVolume > 0 ? vwapNumerator / vwapVolume : bar.close;
    const atr = trueRanges.length >= 14 ? average(trueRanges) : 0;
    const previousVolumes = volumes.slice(-20).filter((value) => value > 0);
    const volumeAverage = previousVolumes.length ? average(previousVolumes) : 0;
    const relativeVolume =
      volumeAverage > 0 && bar.volume > 0 ? bar.volume / volumeAverage : 1;
    const priorTwenty = sessionBars.slice(-20);
    const pivot = priorTwenty.length
      ? Math.max(...priorTwenty.map((item) => item.high))
      : bar.high;
    const range = Math.max(bar.high - bar.low, Number.EPSILON);
    const ema9ThreeBarsAgo = sessionEma9.at(-3);
    const momentumBase = sessionBars.at(-3)?.close;

    if (
      sessionBars.length >= 20 &&
      atr > 0 &&
      ema9ThreeBarsAgo !== undefined &&
      momentumBase !== undefined
    ) {
      features.push({
        index,
        session,
        close: bar.close,
        atr,
        vwapDistance: clamp((bar.close - vwap) / atr, -4, 4),
        emaSpread: clamp((ema9 - ema20) / atr, -3, 3),
        emaSlope: clamp((ema9 - ema9ThreeBarsAgo) / atr, -3, 3),
        relativeVolume: clamp(Math.log(Math.max(relativeVolume, 0.1)), -2.3, 2.3),
        closeLocation: clamp((bar.close - bar.low) / range, 0, 1),
        momentum: clamp((bar.close - momentumBase) / atr, -4, 4),
        breakout: bar.close > pivot,
        green: bar.close >= bar.open,
      });
    }

    sessionBars.push(bar);
    sessionEma9.push(ema9);
    volumes.push(bar.volume);
  });

  return { features, sessions };
}

function distance(left: FeaturePoint, right: FeaturePoint) {
  const numeric = [
    (left.vwapDistance - right.vwapDistance) / 1.4,
    (left.emaSpread - right.emaSpread) / 0.8,
    (left.emaSlope - right.emaSlope) / 0.8,
    (left.relativeVolume - right.relativeVolume) / 0.9,
    (left.closeLocation - right.closeLocation) / 0.45,
    (left.momentum - right.momentum) / 1.2,
  ];
  const squared = numeric.reduce((sum, value) => sum + value * value, 0);
  const breakoutPenalty = left.breakout === right.breakout ? 0 : 0.75;
  const candlePenalty = left.green === right.green ? 0 : 0.3;
  return Math.sqrt(squared + breakoutPenalty ** 2 + candlePenalty ** 2);
}

export function calculateDirectionProbability({
  symbol,
  interval,
  bars,
  timezone,
}: {
  symbol: string;
  interval: "1m" | "5m";
  bars: MarketBar[];
  timezone: string;
}): DirectionProbability {
  const horizonBars = interval === "1m" ? 15 : 6;
  const horizonMinutes = interval === "1m" ? 15 : 30;
  const { features, sessions } = buildFeatures(bars, timezone);
  const current = features.at(-1);

  if (!current || current.index < bars.length - 2) {
    throw new Error("當日完整 K 線不足 20 根，暫不能估計方向概率");
  }

  const candidates: Neighbor[] = [];
  for (const candidate of features) {
    const futureIndex = candidate.index + horizonBars;
    if (futureIndex >= current.index) continue;
    if (sessions[futureIndex] !== candidate.session) continue;
    const future = bars[futureIndex];
    if (!future) continue;
    const elapsedSeconds = future.time - bars[candidate.index].time;
    const targetSeconds = horizonMinutes * 60;
    if (
      elapsedSeconds < targetSeconds * 0.75 ||
      elapsedSeconds > targetSeconds * 1.5
    ) {
      continue;
    }
    const outcome = future.close / candidate.close - 1;
    const threshold = clamp((candidate.atr / candidate.close) * 0.3, 0.0006, 0.004);
    candidates.push({
      distance: distance(current, candidate),
      outcome,
      threshold,
      session: candidate.session,
      recency: candidate.index / Math.max(current.index, 1),
    });
  }

  if (candidates.length < 30) {
    throw new Error("歷史可比片段不足 30 個，暫不能估計方向概率");
  }

  const neighborLimit = interval === "1m" ? 150 : 180;
  const neighbors = candidates
    .sort((left, right) => left.distance - right.distance)
    .slice(0, neighborLimit);

  let upWeight = 0;
  let flatWeight = 0;
  let downWeight = 0;
  let totalWeight = 0;
  let squaredWeight = 0;
  let weightedOutcome = 0;

  for (const neighbor of neighbors) {
    const weight =
      Math.exp(-neighbor.distance * 0.8) * (0.7 + 0.3 * neighbor.recency);
    if (neighbor.outcome > neighbor.threshold) upWeight += weight;
    else if (neighbor.outcome < -neighbor.threshold) downWeight += weight;
    else flatWeight += weight;
    totalWeight += weight;
    squaredWeight += weight * weight;
    weightedOutcome += neighbor.outcome * weight;
  }

  const prior = 3;
  const denominator = totalWeight + prior * 3;
  const upProbability = round(((upWeight + prior) / denominator) * 100, 1);
  const flatProbability = round(((flatWeight + prior) / denominator) * 100, 1);
  const downProbability = round(100 - upProbability - flatProbability, 1);
  const effectiveSampleSize =
    squaredWeight > 0 ? (totalWeight * totalWeight) / squaredWeight : 0;
  const absoluteMoves = neighbors
    .map((neighbor) => Math.abs(neighbor.outcome) * 100)
    .sort((left, right) => left - right);
  const currentFlatBand = clamp((current.atr / current.close) * 0.3, 0.0006, 0.004);

  return {
    symbol,
    interval,
    horizonMinutes,
    upProbability,
    flatProbability,
    downProbability,
    sampleSize: neighbors.length,
    effectiveSampleSize: Math.round(effectiveSampleSize),
    expectedMovePercent: round((weightedOutcome / totalWeight) * 100, 2),
    medianAbsoluteMovePercent: round(
      absoluteMoves[Math.floor(absoluteMoves.length / 2)] ?? 0,
      2,
    ),
    flatBandPercent: round(currentFlatBand * 100, 2),
    historySessions: new Set(neighbors.map((neighbor) => neighbor.session)).size,
    dataThrough: bars.at(-1)?.time ?? 0,
    generatedAt: Date.now(),
    status:
      neighbors.length >= 80 && effectiveSampleSize >= 30 ? "ready" : "limited",
    isPreview: false,
  };
}
