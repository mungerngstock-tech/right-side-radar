export type MarketSession = "PRE" | "REGULAR" | "POST" | "CLOSED";

export const MARKET_INTERVALS = ["1m", "5m", "15m", "30m", "1d"] as const;

export type MarketInterval = (typeof MARKET_INTERVALS)[number];

export const MARKET_INTERVAL_CONFIG: Record<
  MarketInterval,
  {
    label: string;
    seconds: number;
    chartRange: string;
    historyRange: string;
    historyLabel: string;
    horizonBars: number;
    horizonMinutes: number;
    previewBars: number;
    previewVolume: number;
    staleAfterSeconds: number;
  }
> = {
  "1m": {
    label: "1 分鐘",
    seconds: 60,
    chartRange: "1d",
    historyRange: "7d",
    historyLabel: "7 日",
    horizonBars: 15,
    horizonMinutes: 15,
    previewBars: 180,
    previewVolume: 115_000,
    staleAfterSeconds: 180,
  },
  "5m": {
    label: "5 分鐘",
    seconds: 300,
    chartRange: "1d",
    historyRange: "60d",
    historyLabel: "60 日",
    horizonBars: 6,
    horizonMinutes: 30,
    previewBars: 78,
    previewVolume: 490_000,
    staleAfterSeconds: 480,
  },
  "15m": {
    label: "15 分鐘",
    seconds: 900,
    chartRange: "5d",
    historyRange: "60d",
    historyLabel: "60 日",
    horizonBars: 4,
    horizonMinutes: 60,
    previewBars: 100,
    previewVolume: 1_400_000,
    staleAfterSeconds: 1_800,
  },
  "30m": {
    label: "30 分鐘",
    seconds: 1_800,
    chartRange: "1mo",
    historyRange: "60d",
    historyLabel: "60 日",
    horizonBars: 4,
    horizonMinutes: 120,
    previewBars: 96,
    previewVolume: 2_800_000,
    staleAfterSeconds: 3_600,
  },
  "1d": {
    label: "1 日",
    seconds: 86_400,
    chartRange: "6mo",
    historyRange: "5y",
    historyLabel: "5 年",
    horizonBars: 5,
    horizonMinutes: 7_200,
    previewBars: 120,
    previewVolume: 35_000_000,
    staleAfterSeconds: 172_800,
  },
};

export function isMarketInterval(value: unknown): value is MarketInterval {
  return MARKET_INTERVALS.includes(value as MarketInterval);
}

export type MarketBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session: "pre" | "regular" | "post" | "unknown";
};

export type InstrumentData = {
  symbol: string;
  currency: string;
  exchange: string;
  timezone: string;
  marketState: MarketSession;
  livePrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  regularMarketVolume: number;
  fetchedAt: number;
  bars: MarketBar[];
};

export type MarketApiResponse = {
  data: InstrumentData[];
  errors: Array<{ symbol: string; message: string }>;
  fetchedAt: number;
  source: string;
};

export type DirectionProbability = {
  symbol: string;
  interval: MarketInterval;
  horizonMinutes: number;
  upProbability: number;
  flatProbability: number;
  downProbability: number;
  sampleSize: number;
  effectiveSampleSize: number;
  expectedMovePercent: number;
  medianAbsoluteMovePercent: number;
  flatBandPercent: number;
  historySessions: number;
  dataThrough: number;
  generatedAt: number;
  status: "ready" | "limited";
  isPreview: boolean;
};

export type ProbabilityApiResponse = {
  data: DirectionProbability[];
  errors: Array<{ symbol: string; message: string }>;
  fetchedAt: number;
  source: string;
};

export type IndicatorPoint = MarketBar & {
  range: [number, number];
  ema9: number | null;
  ema20: number | null;
  vwap: number | null;
};

export type SignalTone = "positive" | "caution" | "neutral" | "negative";

export type SignalCheck = {
  key: string;
  label: string;
  detail: string;
  passed: boolean;
};

export type MarketAnalysis = {
  status:
    | "右側確認"
    | "接近確認"
    | "等待結構"
    | "未確認"
    | "假突破風險"
    | "放量滯漲"
    | "資料不足";
  tone: SignalTone;
  passed: number;
  total: number;
  checks: SignalCheck[];
  pivot: number | null;
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
  relativeVolume: number | null;
  atr: number | null;
  extensionAtr: number | null;
  closeLocation: number | null;
  isPartialBar: boolean;
  analysisTime: number | null;
  headline: string;
  nextStep: string;
  invalidation: string;
  risks: string[];
};

function ema(values: number[], period: number) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  const result: Array<number | null> = [];
  let current = values[0];

  values.forEach((value, index) => {
    current = index === 0 ? value : value * multiplier + current * (1 - multiplier);
    result.push(index + 1 >= period ? current : null);
  });
  return result;
}

function makeTradingDateFormatter(timezone: string) {
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

function localDateAndMinutes(timestampMs: number, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(timestampMs)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function isBarLikelyPartial(
  barTime: number,
  fetchedAt: number,
  interval: MarketInterval,
  timezone: string,
) {
  if (interval !== "1d") {
    return fetchedAt / 1000 < barTime + MARKET_INTERVAL_CONFIG[interval].seconds;
  }
  try {
    const barLocal = localDateAndMinutes(barTime * 1000, timezone);
    const fetchedLocal = localDateAndMinutes(fetchedAt, timezone);
    return barLocal.date === fetchedLocal.date && fetchedLocal.minutes < 16 * 60;
  } catch {
    return fetchedAt / 1000 < barTime + MARKET_INTERVAL_CONFIG[interval].seconds;
  }
}

export function buildIndicators(
  bars: MarketBar[],
  interval: MarketInterval = "5m",
  timezone = "America/New_York",
): IndicatorPoint[] {
  const ema9 = ema(
    bars.map((bar) => bar.close),
    9,
  );
  const ema20 = ema(
    bars.map((bar) => bar.close),
    20,
  );

  let vwapNumerator = 0;
  let vwapVolume = 0;
  let sawRegularBar = false;
  let activeDate = "";
  const tradingDate = makeTradingDateFormatter(timezone);
  const dailyVwapWindow: Array<{ weightedPrice: number; volume: number }> = [];

  return bars.map((bar, index) => {
    const date = tradingDate.format(bar.time * 1000);
    if (interval !== "1d" && date !== activeDate) {
      activeDate = date;
      vwapNumerator = 0;
      vwapVolume = 0;
      sawRegularBar = false;
    }

    if (interval === "1d" || bar.session === "regular") {
      sawRegularBar = true;
      const typical = (bar.high + bar.low + bar.close) / 3;
      const weightedPrice = typical * bar.volume;
      vwapNumerator += weightedPrice;
      vwapVolume += bar.volume;
      if (interval === "1d") {
        dailyVwapWindow.push({ weightedPrice, volume: bar.volume });
        if (dailyVwapWindow.length > 20) {
          const removed = dailyVwapWindow.shift();
          if (removed) {
            vwapNumerator -= removed.weightedPrice;
            vwapVolume -= removed.volume;
          }
        }
      }
    }

    return {
      ...bar,
      range: [bar.low, bar.high],
      ema9: ema9[index],
      ema20: ema20[index],
      vwap: sawRegularBar && vwapVolume > 0 ? vwapNumerator / vwapVolume : null,
    };
  });
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateAtr(bars: MarketBar[], period = 14) {
  if (bars.length < 2) return null;
  const relevant = bars.slice(-(period + 1));
  const ranges = relevant.slice(1).map((bar, index) => {
    const previousClose = relevant[index].close;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    );
  });
  return average(ranges);
}

function formatLevel(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return value >= 10 ? value.toFixed(2) : value.toFixed(3);
}

export function analyseInstrument(
  instrument: InstrumentData,
  interval: MarketInterval,
): MarketAnalysis {
  const points = buildIndicators(instrument.bars, interval, instrument.timezone);
  const newest = points.at(-1);
  const newestIsPartial = Boolean(
    newest &&
      isBarLikelyPartial(
        newest.time,
        instrument.fetchedAt,
        interval,
        instrument.timezone,
      ),
  );
  const complete = newestIsPartial ? points.slice(0, -1) : points;

  if (complete.length < 22) {
    return {
      status: "資料不足",
      tone: "neutral",
      passed: 0,
      total: 6,
      checks: [],
      pivot: null,
      vwap: null,
      ema9: null,
      ema20: null,
      relativeVolume: null,
      atr: null,
      extensionAtr: null,
      closeLocation: null,
      isPartialBar: newestIsPartial,
      analysisTime: complete.at(-1)?.time ?? null,
      headline: "至少需要 22 根完整 K 線，才足以判讀趨勢與突破。",
      nextStep: "保持畫面開啟，資料足夠後會自動更新。",
      invalidation: "目前沒有足夠結構可定義失效位。",
      risks: ["樣本太短，暫不應把單根 K 線視為訊號。"],
    };
  }

  const last = complete.at(-1)!;
  const previous = complete.at(-2)!;
  const lookback = complete.slice(-21, -1);
  const pivot = Math.max(...lookback.map((bar) => bar.high));
  const previousPivot = Math.max(...complete.slice(-22, -2).map((bar) => bar.high));
  const volumeBase = complete
    .slice(-21, -1)
    .map((bar) => bar.volume)
    .filter((volume) => volume > 0);
  const averageVolume = average(volumeBase);
  const relativeVolume = averageVolume && last.volume > 0 ? last.volume / averageVolume : null;
  const range = Math.max(last.high - last.low, Number.EPSILON);
  const closeLocation = (last.close - last.low) / range;
  const bodyRatio = Math.abs(last.close - last.open) / range;
  const atr = calculateAtr(complete);
  const currentVwap = last.vwap;
  const currentEma9 = last.ema9;
  const currentEma20 = last.ema20;
  const ema9FourBarsAgo = complete.at(-4)?.ema9 ?? null;
  const breakoutNow = last.high > pivot && last.close > pivot;
  const heldBreakout = previous.close > previousPivot && last.close >= previousPivot;
  const falseBreakout =
    (last.high > pivot && last.close < pivot) ||
    (previous.close > previousPivot && last.close < previousPivot);
  const effortNoResult =
    relativeVolume !== null &&
    relativeVolume >= 1.5 &&
    bodyRatio < 0.25 &&
    closeLocation < 0.6;
  const extensionAtr =
    atr && currentVwap !== null ? (last.close - currentVwap) / atr : null;
  const vwapLabel = interval === "1d" ? "20 日量價均線" : "VWAP";

  const checks: SignalCheck[] = [
    {
      key: "vwap",
      label: `價格站上 ${vwapLabel}`,
      detail:
        currentVwap === null
          ? `${vwapLabel}尚未形成`
          : `${formatLevel(last.close)} vs ${formatLevel(currentVwap)}`,
      passed: currentVwap !== null && last.close > currentVwap,
    },
    {
      key: "ema",
      label: "EMA 9 高於 EMA 20",
      detail: `${formatLevel(currentEma9)} vs ${formatLevel(currentEma20)}`,
      passed:
        currentEma9 !== null && currentEma20 !== null && currentEma9 > currentEma20,
    },
    {
      key: "slope",
      label: "短均線正在上斜",
      detail:
        currentEma9 !== null && ema9FourBarsAgo !== null
          ? `${currentEma9 >= ema9FourBarsAgo ? "向上" : "向下"} ${Math.abs(
              (currentEma9 / ema9FourBarsAgo - 1) * 100,
            ).toFixed(2)}%`
          : "尚未形成",
      passed:
        currentEma9 !== null &&
        ema9FourBarsAgo !== null &&
        currentEma9 > ema9FourBarsAgo,
    },
    {
      key: "volume",
      label: "成交量支持",
      detail:
        relativeVolume === null
          ? "無有效成交量"
          : `${relativeVolume.toFixed(2)}× 近 20 根均量`,
      passed: relativeVolume !== null && relativeVolume >= 1.15,
    },
    {
      key: "breakout",
      label: "突破獲得接受",
      detail: `${formatLevel(pivot)} 關鍵位${breakoutNow ? "已突破" : heldBreakout ? "已守住" : "未突破"}`,
      passed: breakoutNow || heldBreakout,
    },
    {
      key: "quality",
      label: "收盤靠近 K 線高位",
      detail: `收於全根 ${Math.round(closeLocation * 100)}% 位置`,
      passed: last.close >= last.open && closeLocation >= 0.65 && bodyRatio >= 0.3,
    },
  ];

  const passed = checks.filter((check) => check.passed).length;
  let status: MarketAnalysis["status"] = "未確認";
  let tone: SignalTone = "neutral";

  if (falseBreakout) {
    status = "假突破風險";
    tone = "negative";
  } else if (effortNoResult) {
    status = "放量滯漲";
    tone = "caution";
  } else if (passed >= 5 && (breakoutNow || heldBreakout)) {
    status = "右側確認";
    tone = "positive";
  } else if (passed >= 4) {
    status = "接近確認";
    tone = "caution";
  } else if (passed >= 2) {
    status = "等待結構";
    tone = "neutral";
  }

  const risks: string[] = [];
  if (extensionAtr !== null && extensionAtr > 1.5) {
    risks.push(`價格已高於${vwapLabel} ${extensionAtr.toFixed(1)} ATR，追價風險偏高。`);
  }
  if (falseBreakout) risks.push("價格曾越過關鍵位但收回其下，買盤未能守住成果。");
  if (effortNoResult) risks.push("成交量明顯放大，但實體與收盤位置偏弱，留意上方供給。");
  if (relativeVolume !== null && relativeVolume < 0.75) {
    risks.push("量能低於近 20 根平均，突破可信度不足。");
  }
  if (risks.length === 0) risks.push("暫未出現明顯價量背離；仍需下一根 K 線延續。");

  const headline =
    status === "右側確認"
      ? `趨勢、量能與 ${formatLevel(pivot)} 突破位同時成立。`
      : status === "接近確認"
        ? `已有 ${passed}/6 項條件成立，尚欠突破或量價延續。`
        : status === "假突破風險"
          ? `突破 ${formatLevel(pivot)} 後未能守住，現在不屬乾淨右側。`
          : status === "放量滯漲"
            ? "成交量增加，但價格沒有給出相稱進展。"
            : `目前只有 ${passed}/6 項條件成立，右側訊號未完整。`;

  const nextStep =
    status === "右側確認"
      ? `觀察下一根能否續守 ${formatLevel(pivot)}；若離${vwapLabel}過遠，等回踩而非追價。`
      : `等待完整 K 線放量收上 ${formatLevel(pivot)}，再看下一根是否守住。`;
  const invalidation =
    currentVwap !== null && currentEma20 !== null
      ? `若收盤跌回${vwapLabel} ${formatLevel(currentVwap)} 下方，且 EMA 9 下穿 EMA 20 ${formatLevel(currentEma20)}，本輪右側結構失效。`
      : `若再次跌破關鍵位 ${formatLevel(pivot)} 並放量，視為結構失效。`;

  return {
    status,
    tone,
    passed,
    total: checks.length,
    checks,
    pivot,
    vwap: currentVwap,
    ema9: currentEma9,
    ema20: currentEma20,
    relativeVolume,
    atr,
    extensionAtr,
    closeLocation,
    isPartialBar: newestIsPartial,
    analysisTime: last.time,
    headline,
    nextStep,
    invalidation,
    risks,
  };
}
