import {
  MARKET_INTERVAL_CONFIG,
  isMarketInterval,
  type InstrumentData,
  type MarketBar,
  type MarketInterval,
  type MarketSession,
} from "@/lib/market";

export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,15}$/;

type YahooMeta = {
  currency?: string;
  symbol?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  exchangeTimezoneName?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  preMarketPrice?: number;
  postMarketPrice?: number;
  fulldayPrice?: number;
  fulldayChange?: number;
  fulldayChangePercent?: number;
  currentTradingPeriod?: {
    pre?: { start?: number; end?: number };
    regular?: { start?: number; end?: number };
    post?: { start?: number; end?: number };
  };
};

type YahooChartResult = {
  meta?: YahooMeta;
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

function sessionFromClock(timestamp: number, timezone: string): MarketBar["session"] {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(timestamp * 1000)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    if (minutes >= 570 && minutes < 960) return "regular";
    if (minutes >= 240 && minutes < 570) return "pre";
    if (minutes >= 960 && minutes < 1_200) return "post";
  } catch {
    return "unknown";
  }
  return "unknown";
}

function sessionForTimestamp(
  timestamp: number,
  meta: YahooMeta,
  interval: MarketInterval,
  includePrePost: boolean,
): MarketBar["session"] {
  if (interval === "1d") return "regular";
  const periods = meta.currentTradingPeriod;
  if (
    periods?.regular?.start &&
    periods.regular.end &&
    timestamp >= periods.regular.start &&
    timestamp < periods.regular.end
  ) {
    return "regular";
  }
  if (
    periods?.pre?.start &&
    periods.pre.end &&
    timestamp >= periods.pre.start &&
    timestamp < periods.pre.end
  ) {
    return "pre";
  }
  if (
    periods?.post?.start &&
    periods.post.end &&
    timestamp >= periods.post.start &&
    timestamp < periods.post.end
  ) {
    return "post";
  }
  if (!includePrePost) return "regular";
  return sessionFromClock(
    timestamp,
    meta.exchangeTimezoneName ?? "America/New_York",
  );
}

function marketState(meta: YahooMeta): MarketSession {
  const now = Math.floor(Date.now() / 1000);
  const periods = meta.currentTradingPeriod;
  if (
    periods?.regular?.start &&
    periods.regular.end &&
    now >= periods.regular.start &&
    now < periods.regular.end
  ) {
    return "REGULAR";
  }
  if (
    periods?.pre?.start &&
    periods.pre.end &&
    now >= periods.pre.start &&
    now < periods.pre.end
  ) {
    return "PRE";
  }
  if (
    periods?.post?.start &&
    periods.post.end &&
    now >= periods.post.start &&
    now < periods.post.end
  ) {
    return "POST";
  }
  return "CLOSED";
}

async function fetchInstrument(
  symbol: string,
  interval: MarketInterval,
  includePrePost: boolean,
): Promise<InstrumentData> {
  const intervalConfig = MARKET_INTERVAL_CONFIG[interval];
  const params = new URLSearchParams({
    range: intervalConfig.chartRange,
    interval,
    includePrePost: String(includePrePost && interval !== "1d"),
    events: "div,splits",
  });
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent": "Mozilla/5.0 (compatible; RightSideRadar/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(response.status === 429 ? "免費行情暫時限流" : `行情回應 ${response.status}`);
  }

  const payload = (await response.json()) as {
    chart?: { result?: YahooChartResult[] | null; error?: { description?: string } | null };
  };
  const result = payload.chart?.result?.[0];
  if (!result?.meta || !result.timestamp || !result.indicators?.quote?.[0]) {
    throw new Error(payload.chart?.error?.description ?? "找不到有效行情");
  }

  const meta = result.meta;
  const quote = result.indicators.quote[0];
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
      session: sessionForTimestamp(time, meta, interval, includePrePost),
    });
  });

  if (!bars.length) throw new Error("暫無可用 K 線");
  const finalBar = bars.at(-1)!;
  const previousClose =
    meta.chartPreviousClose ??
    meta.regularMarketPreviousClose ??
    meta.previousClose ??
    bars[0].open;
  const livePrice =
    meta.fulldayPrice ??
    meta.postMarketPrice ??
    meta.preMarketPrice ??
    meta.regularMarketPrice ??
    finalBar.close;
  const change = meta.fulldayChange ?? livePrice - previousClose;
  const changePercent =
    meta.fulldayChangePercent ??
    meta.regularMarketChangePercent ??
    (previousClose ? (change / previousClose) * 100 : 0);

  return {
    symbol,
    currency: meta.currency ?? "USD",
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? "—",
    timezone: meta.exchangeTimezoneName ?? "America/New_York",
    marketState: marketState(meta),
    livePrice,
    previousClose,
    change,
    changePercent,
    regularMarketVolume:
      meta.regularMarketVolume ??
      bars
        .filter((bar) => bar.session === "regular")
        .reduce((sum, bar) => sum + bar.volume, 0),
    fetchedAt: Date.now(),
    bars,
  };
}

function makePreviewInstrument(
  symbol: string,
  interval: MarketInterval,
  symbolIndex: number,
): InstrumentData {
  const intervalConfig = MARKET_INTERVAL_CONFIG[interval];
  const step = intervalConfig.seconds;
  const count = intervalConfig.previewBars;
  const basePrices: Record<string, number> = {
    MRVL: 238.9,
    AVGO: 381.4,
    NVDA: 214.8,
    CRDO: 176.3,
    LITE: 301.6,
  };
  const base = basePrices[symbol] ?? 80 + symbolIndex * 24;
  const end = Math.floor(Date.now() / 1000 / step) * step;
  const bars: MarketBar[] = [];
  let previous = base * 0.987;

  for (let index = 0; index < count; index += 1) {
    const wave = Math.sin(index / 7 + symbolIndex) * base * 0.0018;
    const drift = base * 0.00009;
    const open = previous;
    const close = open + wave * 0.22 + drift;
    const spread = base * (0.0011 + (index % 5) * 0.00008);
    bars.push({
      time: end - (count - 1 - index) * step,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread * 0.82,
      close,
      volume: Math.round(
        intervalConfig.previewVolume *
          (0.72 + (index % 9) * 0.07) *
          (index > count - 8 ? 1.35 : 1),
      ),
      session: "regular",
    });
    previous = close;
  }

  const livePrice = bars.at(-1)!.close;
  const previousClose = base * 0.985;
  const change = livePrice - previousClose;
  return {
    symbol,
    currency: "USD",
    exchange: "Preview",
    timezone: "America/New_York",
    marketState: "REGULAR",
    livePrice,
    previousClose,
    change,
    changePercent: (change / previousClose) * 100,
    regularMarketVolume: bars.reduce((sum, bar) => sum + bar.volume, 0),
    fetchedAt: Date.now(),
    bars,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const intervalParam = url.searchParams.get("interval") ?? "5m";
  const interval = isMarketInterval(intervalParam) ? intervalParam : "5m";
  const includePrePost = url.searchParams.get("prepost") === "1";
  const symbols = (url.searchParams.get("symbols") ?? "MRVL,AVGO,NVDA,CRDO,LITE")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(
      (symbol, index, all) =>
        SYMBOL_PATTERN.test(symbol) && all.indexOf(symbol) === index,
    )
    .slice(0, 5);

  if (symbols.length !== 5) {
    return Response.json(
      { error: "請提供 5 個不同且有效的股票代號" },
      { status: 400 },
    );
  }

  const settled = await Promise.allSettled(
    symbols.map((symbol) => fetchInstrument(symbol, interval, includePrePost)),
  );
  const data: InstrumentData[] = [];
  const errors: Array<{ symbol: string; message: string }> = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      data.push(result.value);
    } else {
      errors.push({
        symbol: symbols[index],
        message:
          result.reason instanceof Error ? result.reason.message : "行情讀取失敗",
      });
    }
  });

  const previewFallback =
    data.length === 0 && process.env.NODE_ENV === "development";
  if (previewFallback) {
    data.push(
      ...symbols.map((symbol, index) =>
        makePreviewInstrument(symbol, interval, index),
      ),
    );
    errors.length = 0;
  }

  return Response.json(
    {
      data,
      errors,
      error: data.length
        ? undefined
        : errors.map((item) => `${item.symbol}: ${item.message}`).join("；"),
      fetchedAt: Date.now(),
      source: previewFallback
        ? "本機預覽資料（發布版使用真實公開行情）"
        : "Yahoo Finance 公開圖表端點（非官方 API）",
    },
    {
      status: data.length ? 200 : 502,
      headers: {
        "cache-control": "private, max-age=12, stale-while-revalidate=18",
      },
    },
  );
}
