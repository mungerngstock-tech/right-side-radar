import {
  MARKET_INTERVAL_CONFIG,
  isBarLikelyPartial,
  isMarketInterval,
  type DirectionProbability,
  type MarketBar,
  type MarketInterval,
  type ProbabilityApiResponse,
} from "@/lib/market";
import { calculateDirectionProbability } from "@/lib/probability";

export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,15}$/;

type YahooChartResult = {
  meta?: { exchangeTimezoneName?: string };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function fetchHistory(symbol: string, interval: MarketInterval) {
  const intervalConfig = MARKET_INTERVAL_CONFIG[interval];
  const params = new URLSearchParams({
    range: intervalConfig.historyRange,
    interval,
    includePrePost: "false",
    events: "div,splits",
  });
  const response = await fetch(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`,
    {
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "Mozilla/5.0 (compatible; RightSideRadar/1.1)",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "歷史行情暫時限流"
        : `歷史行情回應 ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    chart?: {
      result?: YahooChartResult[] | null;
      error?: { description?: string } | null;
    };
  };
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote) {
    throw new Error(payload.chart?.error?.description ?? "找不到歷史行情");
  }

  const bars: MarketBar[] = [];
  result.timestamp.forEach((time, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index] ?? 0;
    if (
      !isFiniteNumber(time) ||
      !isFiniteNumber(open) ||
      !isFiniteNumber(high) ||
      !isFiniteNumber(low) ||
      !isFiniteNumber(close)
    ) {
      return;
    }
    bars.push({
      time,
      open,
      high,
      low,
      close,
      volume: isFiniteNumber(volume) ? volume : 0,
      session: "regular",
    });
  });

  const timezone = result.meta?.exchangeTimezoneName ?? "America/New_York";
  if (
    bars.length > 1 &&
    isBarLikelyPartial(
      bars.at(-1)?.time ?? 0,
      Date.now(),
      interval,
      timezone,
    )
  ) {
    bars.pop();
  }
  if (bars.length < 60) throw new Error("歷史 K 線不足");

  return calculateDirectionProbability({
    symbol,
    interval,
    bars,
    timezone,
  });
}

function roundPreview(value: number) {
  return Math.round(value * 100) / 100;
}

function makePreviewProbability(
  symbol: string,
  interval: MarketInterval,
  index: number,
): DirectionProbability {
  const seed = [...symbol].reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  );
  const upProbability = 43 + ((seed + index * 3) % 8);
  const downProbability = 28 + ((seed + index * 5) % 8);
  const previewStats: Record<
    MarketInterval,
    {
      sampleSize: number;
      effectiveSampleSize: number;
      medianAbsoluteMovePercent: number;
      flatBandPercent: number;
      historySessions: number;
    }
  > = {
    "1m": {
      sampleSize: 150,
      effectiveSampleSize: 73,
      medianAbsoluteMovePercent: 0.42,
      flatBandPercent: 0.09,
      historySessions: 5,
    },
    "5m": {
      sampleSize: 180,
      effectiveSampleSize: 88,
      medianAbsoluteMovePercent: 0.68,
      flatBandPercent: 0.13,
      historySessions: 37,
    },
    "15m": {
      sampleSize: 180,
      effectiveSampleSize: 90,
      medianAbsoluteMovePercent: 0.95,
      flatBandPercent: 0.18,
      historySessions: 45,
    },
    "30m": {
      sampleSize: 180,
      effectiveSampleSize: 92,
      medianAbsoluteMovePercent: 1.2,
      flatBandPercent: 0.25,
      historySessions: 52,
    },
    "1d": {
      sampleSize: 200,
      effectiveSampleSize: 105,
      medianAbsoluteMovePercent: 4.8,
      flatBandPercent: 1,
      historySessions: 190,
    },
  };
  const stats = previewStats[interval];
  return {
    symbol,
    interval,
    horizonMinutes: MARKET_INTERVAL_CONFIG[interval].horizonMinutes,
    upProbability,
    flatProbability: 100 - upProbability - downProbability,
    downProbability,
    sampleSize: stats.sampleSize,
    effectiveSampleSize: stats.effectiveSampleSize,
    expectedMovePercent: roundPreview(((seed % 7) - 2) * 0.04),
    medianAbsoluteMovePercent: stats.medianAbsoluteMovePercent,
    flatBandPercent: stats.flatBandPercent,
    historySessions: stats.historySessions,
    dataThrough: Math.floor(Date.now() / 1000),
    generatedAt: Date.now(),
    status: "ready",
    isPreview: true,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const intervalParam = url.searchParams.get("interval") ?? "5m";
  const interval = isMarketInterval(intervalParam) ? intervalParam : "5m";
  const symbols = (
    url.searchParams.get("symbols") ??
    url.searchParams.get("symbol") ??
    "MRVL"
  )
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(
      (symbol, index, all) =>
        SYMBOL_PATTERN.test(symbol) && all.indexOf(symbol) === index,
    )
    .slice(0, 5);

  if (!symbols.length) {
    return Response.json({ error: "請提供有效股票代號" }, { status: 400 });
  }

  const settled = await Promise.allSettled(
    symbols.map((symbol) => fetchHistory(symbol, interval)),
  );
  const data: DirectionProbability[] = [];
  const errors: Array<{ symbol: string; message: string }> = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      data.push(result.value);
    } else if (process.env.NODE_ENV === "development") {
      data.push(makePreviewProbability(symbols[index], interval, index));
    } else {
      errors.push({
        symbol: symbols[index],
        message:
          result.reason instanceof Error
            ? result.reason.message
            : "方向概率計算失敗",
      });
    }
  });

  const preview = data.some((item) => item.isPreview);
  const payload: ProbabilityApiResponse & { error?: string } = {
    data,
    errors,
    fetchedAt: Date.now(),
    source: preview
      ? "本機預覽概率（發布版使用真實歷史行情）"
      : "同股歷史相似價量片段",
    error: data.length
      ? undefined
      : errors.map((item) => `${item.symbol}: ${item.message}`).join("；"),
  };

  return Response.json(payload, {
    status: data.length ? 200 : 502,
    headers: {
      "cache-control": "private, max-age=900, stale-while-revalidate=900",
    },
  });
}
