"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  Clock3,
  Edit3,
  RefreshCw,
  ShieldAlert,
  Signal,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  analyseInstrument,
  buildIndicators,
  isMarketInterval,
  MARKET_INTERVAL_CONFIG,
  MARKET_INTERVALS,
  type DirectionProbability,
  type IndicatorPoint,
  type InstrumentData,
  type MarketAnalysis,
  type MarketApiResponse,
  type MarketInterval,
  type ProbabilityApiResponse,
  type SignalTone,
} from "@/lib/market";

const DEFAULT_SYMBOLS = ["MRVL", "AVGO", "NVDA", "CRDO", "LITE"];
const STORAGE_KEY = "right-side-radar-settings-v1";
const REFRESH_SECONDS = 30;

type StoredSettings = {
  symbols: string[];
  interval: MarketInterval;
  prepost: boolean;
};

const toneClasses: Record<SignalTone, string> = {
  positive: "border-teal-400/30 bg-teal-400/10 text-teal-300",
  caution: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  neutral: "border-slate-500/30 bg-slate-400/10 text-slate-300",
  negative: "border-rose-400/30 bg-rose-400/10 text-rose-300",
};

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value >= 10 ? value.toFixed(2) : value.toFixed(3);
}

function formatVolume(value: number) {
  return new Intl.NumberFormat("zh-Hant", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatChartTime(
  timestamp: number,
  timezone: string,
  interval: MarketInterval,
  detailed = false,
) {
  const showDate = interval === "1d" || interval === "15m" || interval === "30m";
  return new Intl.DateTimeFormat("zh-Hant", {
    timeZone: timezone,
    ...(showDate || detailed
      ? {
          year: interval === "1d" && detailed ? ("numeric" as const) : undefined,
          month: "2-digit" as const,
          day: "2-digit" as const,
        }
      : {}),
    ...(interval === "1d"
      ? {}
      : {
          hour: "2-digit" as const,
          minute: "2-digit" as const,
          hour12: false,
        }),
  }).format(timestamp * 1000);
}

function formatHorizon(minutes: number, interval: MarketInterval) {
  if (interval === "1d") return `${minutes / 1_440} 個交易日`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} 小時`;
  return `${minutes} 分鐘`;
}

function marketStateLabel(state: InstrumentData["marketState"]) {
  return { PRE: "盤前", REGULAR: "開市", POST: "盤後", CLOSED: "休市" }[state];
}

function CandleShape(rawProps: unknown) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = rawProps as {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    payload?: IndicatorPoint;
  };
  if (!payload) return null;
  const spread = Math.max(payload.high - payload.low, Number.EPSILON);
  const bodyTop =
    y + ((payload.high - Math.max(payload.open, payload.close)) / spread) * height;
  const bodyHeight = Math.max(
    1.5,
    (Math.abs(payload.close - payload.open) / spread) * height,
  );
  const color = payload.close >= payload.open ? "#2dd4bf" : "#fb7185";
  const center = x + width / 2;
  const bodyWidth = Math.max(2, Math.min(width * 0.72, 8));

  return (
    <g>
      <line
        x1={center}
        x2={center}
        y1={y}
        y2={y + height}
        stroke={color}
        strokeWidth={1}
      />
      <rect
        x={center - bodyWidth / 2}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        rx={0.75}
        fill={color}
      />
    </g>
  );
}

function SignalBadge({ analysis }: { analysis: MarketAnalysis }) {
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full px-2.5 py-1 text-xs", toneClasses[analysis.tone])}
    >
      {analysis.status}
    </Badge>
  );
}

function WatchCard({
  symbol,
  instrument,
  analysis,
  probability,
  selected,
  error,
  loading,
  onSelect,
}: {
  symbol: string;
  instrument?: InstrumentData;
  analysis?: MarketAnalysis;
  probability?: DirectionProbability;
  selected: boolean;
  error?: string;
  loading: boolean;
  onSelect: () => void;
}) {
  if (loading && !instrument) {
    return (
      <Card className="min-w-[210px] border-white/8 bg-[#101b2b]">
        <CardContent className="space-y-4 p-4">
          <Skeleton className="h-5 w-16 bg-white/8" />
          <Skeleton className="h-8 w-28 bg-white/8" />
          <Skeleton className="h-5 w-24 bg-white/8" />
        </CardContent>
      </Card>
    );
  }

  const positive = (instrument?.changePercent ?? 0) >= 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "min-w-[210px] rounded-xl text-left outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-300",
        selected ? "ring-1 ring-cyan-300/70" : "hover:-translate-y-0.5",
      )}
      aria-pressed={selected}
    >
      <Card
        className={cn(
          "h-full border-white/8 bg-[#101b2b] shadow-none",
          selected && "bg-[#122338]",
        )}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-base font-semibold tracking-[0.08em] text-white">
                {symbol}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {instrument ? marketStateLabel(instrument.marketState) : "行情錯誤"}
              </p>
            </div>
            {analysis ? <SignalBadge analysis={analysis} /> : null}
          </div>
          {instrument ? (
            <>
              <div className="mt-5 flex items-end justify-between gap-3">
                <p className="font-mono text-2xl font-semibold tabular-nums text-white">
                  {formatPrice(instrument.livePrice)}
                </p>
                <p
                  className={cn(
                    "font-mono text-sm font-medium tabular-nums",
                    positive ? "text-teal-300" : "text-rose-300",
                  )}
                >
                  {positive ? "+" : ""}
                  {instrument.changePercent.toFixed(2)}%
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                <span>右側條件</span>
                <span className="font-mono text-slate-300">
                  {analysis?.passed ?? 0}/{analysis?.total ?? 6}
                </span>
              </div>
              <Progress
                value={((analysis?.passed ?? 0) / (analysis?.total ?? 6)) * 100}
                className="mt-2 h-1.5 bg-white/8 [&>div]:bg-cyan-300"
              />
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/6 pt-3 font-mono text-xs tabular-nums">
                <span className="flex items-center gap-1.5 text-teal-300">
                  <TrendingUp className="h-3.5 w-3.5" />
                  升 {probability ? `${probability.upProbability.toFixed(1)}%` : "—"}
                </span>
                <span className="flex items-center justify-end gap-1.5 text-rose-300">
                  <TrendingDown className="h-3.5 w-3.5" />
                  跌 {probability ? `${probability.downProbability.toFixed(1)}%` : "—"}
                </span>
              </div>
            </>
          ) : (
            <div className="mt-5 rounded-lg border border-rose-400/15 bg-rose-400/5 p-3 text-sm text-rose-300">
              {error ?? "暫時無法取得行情"}
            </div>
          )}
        </CardContent>
      </Card>
    </button>
  );
}

function PriceChart({
  instrument,
  analysis,
  interval,
}: {
  instrument: InstrumentData;
  analysis: MarketAnalysis;
  interval: MarketInterval;
}) {
  const points = useMemo(
    () => buildIndicators(instrument.bars, interval, instrument.timezone),
    [instrument.bars, instrument.timezone, interval],
  );
  const visible = points.slice(-MARKET_INTERVAL_CONFIG[interval].previewBars);
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const activePoint =
    activeTime === null
      ? null
      : visible.find((point) => point.time === activeTime) ?? null;
  const chartSyncId = `price-volume-${instrument.symbol}-${interval}`;
  const low = Math.min(...visible.map((point) => point.low));
  const high = Math.max(...visible.map((point) => point.high));
  const padding = Math.max((high - low) * 0.08, high * 0.001);

  const handleChartMove = (state: { activeLabel?: string | number } | null) => {
    const nextTime = Number(state?.activeLabel);
    setActiveTime(Number.isFinite(nextTime) ? nextTime : null);
  };

  return (
    <div>
      <ChartContainer
        config={{
          ema9: { label: "EMA 9", color: "#60a5fa" },
          ema20: { label: "EMA 20", color: "#a78bfa" },
          vwap: {
            label: interval === "1d" ? "20 日量價均線" : "VWAP",
            color: "#fbbf24",
          },
        }}
        className="h-[330px] w-full aspect-auto"
        initialDimension={{ width: 760, height: 330 }}
      >
        <ComposedChart
          data={visible}
          margin={{ top: 10, right: 8, bottom: 2, left: 0 }}
          syncId={chartSyncId}
          syncMethod="value"
          onMouseMove={handleChartMove}
          onMouseLeave={() => setActiveTime(null)}
        >
          <CartesianGrid
            strokeDasharray="2 6"
            vertical={false}
            stroke="rgba(148,163,184,.12)"
          />
          <XAxis
            dataKey="time"
            minTickGap={48}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) =>
              formatChartTime(Number(value), instrument.timezone, interval)
            }
            tick={{ fill: "#64748b", fontSize: 11 }}
          />
          <YAxis
            orientation="right"
            domain={[low - padding, high + padding]}
            tickLine={false}
            axisLine={false}
            width={58}
            tickFormatter={(value) => formatPrice(Number(value))}
            tick={{ fill: "#64748b", fontSize: 11 }}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                className="border-white/10 bg-[#0a1320] text-slate-200"
                labelFormatter={(_, payload) => {
                  const time = payload?.[0]?.payload?.time;
                  return time
                    ? formatChartTime(time, instrument.timezone, interval, true)
                    : "";
                }}
                formatter={(value, name) => (
                  <div className="flex min-w-32 items-center justify-between gap-4">
                    <span className="text-slate-400">{String(name).toUpperCase()}</span>
                    <span className="font-mono text-slate-100">
                      {formatPrice(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Bar
            dataKey="range"
            shape={CandleShape}
            isAnimationActive={false}
            maxBarSize={9}
          />
          <Line
            type="monotone"
            dataKey="ema9"
            stroke="var(--color-ema9)"
            strokeWidth={1.5}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ema20"
            stroke="var(--color-ema20)"
            strokeWidth={1.4}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="vwap"
            stroke="var(--color-vwap)"
            strokeWidth={1.4}
            strokeDasharray="4 4"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          {analysis.pivot !== null ? (
            <ReferenceLine
              y={analysis.pivot}
              stroke="#22d3ee"
              strokeDasharray="3 5"
              strokeOpacity={0.75}
            />
          ) : null}
          {activeTime !== null ? (
            <ReferenceLine
              x={activeTime}
              stroke="#e2e8f0"
              strokeDasharray="3 4"
              strokeOpacity={0.7}
            />
          ) : null}
        </ComposedChart>
      </ChartContainer>

      <div className="mt-1 flex h-6 items-center justify-between px-1 text-xs text-slate-500">
        <span>成交量</span>
        <span className="font-mono tabular-nums text-slate-300">
          {activePoint
            ? `${formatChartTime(activePoint.time, instrument.timezone, interval, true)} · ${formatVolume(activePoint.volume)}`
            : "指向 K 線查看對應柱"}
        </span>
      </div>
      <ChartContainer
        config={{ volume: { label: "成交量", color: "#334155" } }}
        className="h-[92px] w-full aspect-auto"
        initialDimension={{ width: 760, height: 92 }}
      >
        <ComposedChart
          data={visible}
          margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
          syncId={chartSyncId}
          syncMethod="value"
          onMouseMove={handleChartMove}
          onMouseLeave={() => setActiveTime(null)}
        >
          <XAxis dataKey="time" hide />
          <YAxis
            orientation="right"
            width={58}
            tick={false}
            tickLine={false}
            axisLine={false}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                className="border-white/10 bg-[#0a1320] text-slate-200"
                labelFormatter={(_, payload) => {
                  const time = payload?.[0]?.payload?.time;
                  return time
                    ? formatChartTime(time, instrument.timezone, interval, true)
                    : "";
                }}
                formatter={(value) => (
                  <div className="flex min-w-32 items-center justify-between gap-4">
                    <span className="text-slate-400">成交量</span>
                    <span className="font-mono text-slate-100">
                      {formatVolume(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Bar dataKey="volume" isAnimationActive={false} maxBarSize={8}>
            {visible.map((bar) => {
              const isActive = bar.time === activeTime;
              const rising = bar.close >= bar.open;
              return (
                <Cell
                  key={bar.time}
                  fill={
                    rising
                      ? isActive
                        ? "rgba(45,212,191,.95)"
                        : "rgba(45,212,191,.45)"
                      : isActive
                        ? "rgba(251,113,133,.95)"
                        : "rgba(251,113,133,.45)"
                  }
                  stroke={isActive ? "#e2e8f0" : "transparent"}
                  strokeWidth={isActive ? 1.25 : 0}
                />
              );
            })}
          </Bar>
          {activeTime !== null ? (
            <ReferenceLine
              x={activeTime}
              stroke="#e2e8f0"
              strokeDasharray="3 4"
              strokeOpacity={0.7}
            />
          ) : null}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}

function ProbabilityPanel({
  probability,
  loading,
  error,
  interval,
}: {
  probability?: DirectionProbability;
  loading: boolean;
  error?: string;
  interval: MarketInterval;
}) {
  if (loading && !probability) {
    return (
      <div className="rounded-xl border border-white/8 bg-[#0a1320] p-4">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-4 w-28 bg-white/8" />
          <Skeleton className="h-5 w-20 bg-white/8" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-20 bg-white/8" />
          ))}
        </div>
      </div>
    );
  }

  if (!probability) {
    return (
      <div className="rounded-xl border border-amber-300/15 bg-amber-300/5 p-4">
        <p className="text-sm font-medium text-amber-200">方向概率暫時不可用</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {error ?? "歷史行情不足，稍後更新會再計算。"}
        </p>
      </div>
    );
  }

  const scenarios = [
    {
      label: "上漲",
      value: probability.upProbability,
      text: "text-teal-300",
      bar: "bg-teal-300",
    },
    {
      label: "橫行",
      value: probability.flatProbability,
      text: "text-amber-200",
      bar: "bg-amber-200",
    },
    {
      label: "下跌",
      value: probability.downProbability,
      text: "text-rose-300",
      bar: "bg-rose-300",
    },
  ];
  const expectedPositive = probability.expectedMovePercent >= 0;

  return (
    <div className="rounded-xl border border-white/8 bg-[#0a1320] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-100">歷史方向概率</p>
          <p className="mt-0.5 text-xs text-slate-500">
            同一股票的相似價量片段
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-cyan-300/20 bg-cyan-300/5 text-cyan-200"
        >
          未來 {formatHorizon(probability.horizonMinutes, interval)}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {scenarios.map((scenario) => (
          <div
            key={scenario.label}
            className="rounded-lg border border-white/6 bg-white/[0.025] p-3"
          >
            <p className="text-xs text-slate-500">{scenario.label}</p>
            <p
              className={cn(
                "mt-1 font-mono text-xl font-semibold tabular-nums",
                scenario.text,
              )}
            >
              {scenario.value.toFixed(1)}%
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/6">
              <div
                className={cn("h-full rounded-full", scenario.bar)}
                style={{ width: `${scenario.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-white/6 px-3 py-2.5">
          <p className="text-slate-500">相似樣本</p>
          <p className="mt-1 font-mono text-slate-200">
            {probability.sampleSize} 個 · {probability.historySessions} 個交易日
          </p>
        </div>
        <div className="rounded-lg border border-white/6 px-3 py-2.5">
          <p className="text-slate-500">樣本預期變動</p>
          <p
            className={cn(
              "mt-1 font-mono",
              expectedPositive ? "text-teal-300" : "text-rose-300",
            )}
          >
            {expectedPositive ? "+" : ""}
            {probability.expectedMovePercent.toFixed(2)}%
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-600">
        {MARKET_INTERVAL_CONFIG[interval].historyLabel}歷史相似度估計；波動在 ±
        {probability.flatBandPercent.toFixed(2)}% 內列作橫行。概率不是保證，突發新聞不在模型內。
      </p>
    </div>
  );
}

function AnalysisPanel({
  instrument,
  analysis,
  probability,
  probabilityLoading,
  probabilityError,
  interval,
}: {
  instrument: InstrumentData;
  analysis: MarketAnalysis;
  probability?: DirectionProbability;
  probabilityLoading: boolean;
  probabilityError?: string;
  interval: MarketInterval;
}) {
  return (
    <Card className="h-full border-white/8 bg-[#101b2b] shadow-none">
      <CardHeader className="border-b border-white/8 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-cyan-300/80">
              RIGHT-SIDE READ
            </p>
            <CardTitle className="mt-2 text-xl text-white">
              {analysis.status}
            </CardTitle>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#0a1320] px-3 py-2 text-right">
            <p className="text-xs text-slate-500">條件</p>
            <p className="font-mono text-xl font-semibold text-white">
              {analysis.passed}/{analysis.total}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-300">{analysis.headline}</p>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <ProbabilityPanel
          probability={probability}
          loading={probabilityLoading}
          error={probabilityError}
          interval={interval}
        />

        <div className="grid grid-cols-3 gap-2">
          {[
            [interval === "1d" ? "20 日量價均線" : "VWAP", formatPrice(analysis.vwap)],
            ["突破位", formatPrice(analysis.pivot)],
            [
              "相對量",
              analysis.relativeVolume === null
                ? "—"
                : analysis.relativeVolume.toFixed(2) + "×",
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-white/8 bg-[#0a1320] p-3"
            >
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 font-mono text-sm font-semibold text-slate-100">
                {value}
              </p>
            </div>
          ))}
        </div>

        <div className="space-y-2.5">
          {analysis.checks.map((check) => (
            <div
              key={check.key}
              className="flex items-start gap-3 rounded-lg border border-white/6 px-3 py-2.5"
            >
              <span
                className={cn(
                  "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full",
                  check.passed
                    ? "bg-teal-300/15 text-teal-300"
                    : "bg-white/6 text-slate-600",
                )}
              >
                {check.passed ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-200">{check.label}</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">
                  {check.detail}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/5 p-4">
          <p className="text-xs font-semibold tracking-wide text-cyan-300">下一步</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {analysis.nextStep}
          </p>
        </div>
        <div className="rounded-xl border border-rose-300/15 bg-rose-300/5 p-4">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-rose-300">
            <ShieldAlert className="h-4 w-4" /> 失效條件
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {analysis.invalidation}
          </p>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">
            風險提示
          </p>
          {analysis.risks.map((risk) => (
            <p key={risk} className="flex gap-2 text-sm leading-6 text-slate-400">
              <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span>{risk}</span>
            </p>
          ))}
        </div>
        <p className="border-t border-white/8 pt-3 text-xs leading-5 text-slate-600">
          判讀使用{" "}
          {formatChartTime(
            analysis.analysisTime ?? instrument.bars.at(-1)?.time ?? 0,
            instrument.timezone,
            interval,
            true,
          )}{" "}
          的最後完整 K 線；目前形成中的 K 線不計入量能確認。
        </p>
      </CardContent>
    </Card>
  );
}

export function MarketDashboard() {
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [draftSymbols, setDraftSymbols] = useState(DEFAULT_SYMBOLS);
  const [interval, setIntervalValue] = useState<MarketInterval>("5m");
  const [prepost, setPrepost] = useState(false);
  const [selected, setSelected] = useState(DEFAULT_SYMBOLS[0]);
  const [records, setRecords] = useState<Record<string, InstrumentData>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [probabilities, setProbabilities] = useState<
    Record<string, DirectionProbability>
  >({});
  const [probabilityErrors, setProbabilityErrors] = useState<
    Record<string, string>
  >({});
  const [probabilityLoading, setProbabilityLoading] = useState(true);
  const [probabilityReload, setProbabilityReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [dataSource, setDataSource] = useState("公開免金鑰行情");
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftError, setDraftError] = useState("");
  const requestId = useRef(0);
  const probabilityRequestId = useRef(0);

  useEffect(() => {
    let restoreTimer: number | undefined;
    try {
      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? "null",
      ) as StoredSettings | null;
      if (
        stored &&
        Array.isArray(stored.symbols) &&
        stored.symbols.length === 5 &&
        stored.symbols.every((symbol) =>
          /^[A-Z0-9.^=-]{1,15}$/.test(symbol),
        )
      ) {
        restoreTimer = window.setTimeout(() => {
          setSymbols(stored.symbols);
          setDraftSymbols(stored.symbols);
          setSelected(stored.symbols[0]);
          setIntervalValue(
            isMarketInterval(stored.interval) ? stored.interval : "5m",
          );
          setPrepost(Boolean(stored.prepost));
        }, 0);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    return () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ symbols, interval, prepost }),
    );
  }, [symbols, interval, prepost]);

  const loadMarket = useCallback(
    async (manual = false) => {
      const id = ++requestId.current;
      if (manual) setRefreshing(true);
      try {
        const query = new URLSearchParams({
          symbols: symbols.join(","),
          interval,
          prepost: prepost ? "1" : "0",
        });
        const response = await fetch("/api/market?" + query, {
          cache: "no-store",
        });
        const payload = (await response.json()) as MarketApiResponse & {
          error?: string;
        };
        if (!response.ok && !payload.data?.length) {
          throw new Error(
            payload.error ?? payload.errors?.[0]?.message ?? "行情讀取失敗",
          );
        }
        if (id !== requestId.current) return;
        const nextRecords = Object.fromEntries(
          payload.data.map((item) => [item.symbol, item]),
        );
        const nextErrors = Object.fromEntries(
          payload.errors.map((item) => [item.symbol, item.message]),
        );
        setRecords(nextRecords);
        setErrors(nextErrors);
        setLastRefresh(payload.fetchedAt);
        setDataSource(payload.source);
        setCountdown(REFRESH_SECONDS);
      } catch (error) {
        if (id !== requestId.current) return;
        const message = error instanceof Error ? error.message : "行情讀取失敗";
        setErrors(Object.fromEntries(symbols.map((symbol) => [symbol, message])));
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [symbols, interval, prepost],
  );

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void loadMarket(), 0);
    const refreshTimer = window.setInterval(
      () => void loadMarket(),
      REFRESH_SECONDS * 1000,
    );
    const countdownTimer = window.setInterval(() => {
      setCountdown((value) => (value <= 1 ? REFRESH_SECONDS : value - 1));
    }, 1000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadMarket();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
      window.clearInterval(countdownTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadMarket]);

  useEffect(() => {
    const id = ++probabilityRequestId.current;
    const requestTimer = window.setTimeout(() => {
      setProbabilityLoading(true);
      setProbabilities({});
      setProbabilityErrors({});
      const query = new URLSearchParams({
        symbols: symbols.join(","),
        interval,
      });

      void fetch("/api/probability?" + query, { cache: "no-store" })
        .then(async (response) => {
          const payload = (await response.json()) as ProbabilityApiResponse & {
            error?: string;
          };
          if (!response.ok && !payload.data?.length) {
            throw new Error(
              payload.error ??
                payload.errors?.[0]?.message ??
                "方向概率讀取失敗",
            );
          }
          if (id !== probabilityRequestId.current) return;
          setProbabilities(
            Object.fromEntries(payload.data.map((item) => [item.symbol, item])),
          );
          setProbabilityErrors(
            Object.fromEntries(
              payload.errors.map((item) => [item.symbol, item.message]),
            ),
          );
        })
        .catch((error: unknown) => {
          if (id !== probabilityRequestId.current) return;
          const message =
            error instanceof Error ? error.message : "方向概率讀取失敗";
          setProbabilities({});
          setProbabilityErrors(
            Object.fromEntries(symbols.map((symbol) => [symbol, message])),
          );
        })
        .finally(() => {
          if (id === probabilityRequestId.current) setProbabilityLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(requestTimer);
    };
  }, [symbols, interval, probabilityReload]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setProbabilityReload((value) => value + 1),
      5 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const analyses = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(records).map(([symbol, record]) => [
          symbol,
          analyseInstrument(record, interval),
        ]),
      ) as Record<string, MarketAnalysis>,
    [records, interval],
  );

  const fallbackSymbol = symbols.find((symbol) => records[symbol]) ?? "";
  const active = records[selected] ?? records[fallbackSymbol];
  const activeAnalysis = active ? analyses[active.symbol] : undefined;

  useEffect(() => {
    const modelContext = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options?: { signal?: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();

    const register = async () => {
      await modelContext.registerTool(
        {
          name: "set_watchlist",
          title: "設定五股監察名單",
          description: "把右側雷達的監察名單更新為五個不同股票代號。",
          inputSchema: {
            type: "object",
            properties: {
              symbols: {
                type: "array",
                minItems: 5,
                maxItems: 5,
                uniqueItems: true,
                items: {
                  type: "string",
                  pattern: "^[A-Za-z0-9.^=-]{1,15}$",
                },
              },
            },
            required: ["symbols"],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            untrustedContentHint: false,
          },
          execute(input: unknown) {
            const candidate = input as { symbols?: unknown };
            if (
              !Array.isArray(candidate.symbols) ||
              candidate.symbols.length !== 5
            ) {
              throw new Error("需要剛好五個股票代號");
            }
            const normalized = candidate.symbols.map((symbol) =>
              String(symbol).trim().toUpperCase(),
            );
            if (
              new Set(normalized).size !== 5 ||
              normalized.some(
                (symbol) => !/^[A-Z0-9.^=-]{1,15}$/.test(symbol),
              )
            ) {
              throw new Error("股票代號無效或重複");
            }
            setSymbols(normalized);
            setDraftSymbols(normalized);
            setSelected(normalized[0]);
            return { symbols: normalized };
          },
        },
        { signal: lifecycle.signal },
      );
      await modelContext.registerTool(
        {
          name: "set_chart_preferences",
          title: "設定圖表",
          description:
            "設定 1、5、15、30 分鐘或 1 日 K 線，以及是否顯示盤前盤後。",
          inputSchema: {
            type: "object",
            properties: {
              interval: { type: "string", enum: [...MARKET_INTERVALS] },
              includePrePost: { type: "boolean" },
            },
            required: ["interval", "includePrePost"],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            untrustedContentHint: false,
          },
          execute(input: unknown) {
            const candidate = input as {
              interval?: unknown;
              includePrePost?: unknown;
            };
            if (!isMarketInterval(candidate.interval)) {
              throw new Error("interval 只可為 1m、5m、15m、30m 或 1d");
            }
            if (typeof candidate.includePrePost !== "boolean") {
              throw new Error("includePrePost 必須為布林值");
            }
            setIntervalValue(candidate.interval);
            setPrepost(candidate.includePrePost);
            return {
              interval: candidate.interval,
              includePrePost: candidate.includePrePost,
            };
          },
        },
        { signal: lifecycle.signal },
      );
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const applySymbols = () => {
    const normalized = draftSymbols.map((symbol) =>
      symbol.trim().toUpperCase(),
    );
    if (
      normalized.some((symbol) => !/^[A-Z0-9.^=-]{1,15}$/.test(symbol))
    ) {
      setDraftError("每一格都要填入有效股票代號。");
      return;
    }
    if (new Set(normalized).size !== 5) {
      setDraftError("五個股票代號不可重複。");
      return;
    }
    setSymbols(normalized);
    setSelected(normalized[0]);
    setDraftError("");
    setDialogOpen(false);
    setLoading(true);
  };

  const positive = (active?.changePercent ?? 0) >= 0;
  const stale = Boolean(
    active?.marketState === "REGULAR" &&
      active.bars.at(-1)?.time &&
      active.fetchedAt / 1000 - active.bars.at(-1)!.time >
        MARKET_INTERVAL_CONFIG[interval].staleAfterSeconds,
  );

  return (
    <main className="min-h-screen bg-[#07101b] text-slate-100">
      <header className="border-b border-white/8 bg-[#08131f]/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 font-mono text-sm font-black text-cyan-300">
              R5
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">
                右側雷達
              </h1>
              <p className="text-xs text-slate-500">五股價量確認</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select
              value={interval}
              onValueChange={(value) => {
                if (isMarketInterval(value)) setIntervalValue(value);
              }}
            >
              <SelectTrigger className="h-9 border-white/10 bg-white/5 text-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-[#101b2b] text-slate-100">
                {MARKET_INTERVALS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {MARKET_INTERVAL_CONFIG[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label
              className={cn(
                "flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-300",
                interval === "1d" && "cursor-not-allowed opacity-50",
              )}
              title={interval === "1d" ? "日線不適用盤前盤後" : undefined}
            >
              <Switch
                checked={interval === "1d" ? false : prepost}
                onCheckedChange={setPrepost}
                disabled={interval === "1d"}
                aria-label="顯示盤前盤後"
              />
              盤前後
            </label>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                >
                  <Edit3 /> 五股名單
                </Button>
              </DialogTrigger>
              <DialogContent className="border-white/10 bg-[#0d1827] text-slate-100 sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>設定五股監察名單</DialogTitle>
                  <DialogDescription className="text-slate-400">
                    輸入美股代號；儲存後會立即重新抓取行情。
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3 py-3 sm:grid-cols-5">
                  {draftSymbols.map((symbol, index) => (
                    <Input
                      key={index}
                      value={symbol}
                      maxLength={15}
                      aria-label={"第 " + (index + 1) + " 個股票代號"}
                      onChange={(event) => {
                        const next = [...draftSymbols];
                        next[index] = event.target.value.toUpperCase();
                        setDraftSymbols(next);
                      }}
                      className="border-white/10 bg-[#07101b] text-center font-mono uppercase text-white"
                    />
                  ))}
                </div>
                {draftError ? (
                  <p className="text-sm text-rose-300">{draftError}</p>
                ) : null}
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setDialogOpen(false)}
                    className="text-slate-400 hover:bg-white/5 hover:text-white"
                  >
                    取消
                  </Button>
                  <Button
                    onClick={applySymbols}
                    className="bg-cyan-300 text-[#07101b] hover:bg-cyan-200"
                  >
                    儲存並更新
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                void loadMarket(true);
                setProbabilityReload((value) => value + 1);
              }}
              disabled={refreshing}
              aria-label="立即更新行情"
              className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1560px] px-4 py-5 sm:px-6 lg:px-8">
        <section
          aria-label="五股監察"
          className="flex gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-5 lg:overflow-visible"
        >
          {symbols.map((symbol) => (
            <WatchCard
              key={symbol}
              symbol={symbol}
              instrument={records[symbol]}
              analysis={analyses[symbol]}
              probability={probabilities[symbol]}
              selected={selected === symbol}
              error={errors[symbol]}
              loading={loading}
              onSelect={() => setSelected(symbol)}
            />
          ))}
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
          <Card className="min-w-0 border-white/8 bg-[#101b2b] shadow-none">
            <CardHeader className="border-b border-white/8 pb-4">
              {active ? (
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xl tracking-[0.08em] text-white">
                        {active.symbol}
                      </CardTitle>
                      <Badge
                        variant="outline"
                        className="border-white/10 text-slate-400"
                      >
                        {marketStateLabel(active.marketState)}
                      </Badge>
                      {stale ? (
                        <Badge
                          variant="outline"
                          className="border-amber-300/30 text-amber-300"
                        >
                          資料延遲
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 flex items-baseline gap-3">
                      <p className="font-mono text-3xl font-semibold tabular-nums text-white">
                        {formatPrice(active.livePrice)}
                      </p>
                      <p
                        className={cn(
                          "font-mono text-sm",
                          positive ? "text-teal-300" : "text-rose-300",
                        )}
                      >
                        {positive ? "+" : ""}
                        {active.change.toFixed(2)} ({positive ? "+" : ""}
                        {active.changePercent.toFixed(2)}%)
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <BarChart3 className="h-3.5 w-3.5" /> 成交量{" "}
                      {formatVolume(active.regularMarketVolume)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5" />{" "}
                      {MARKET_INTERVAL_CONFIG[interval].label} K
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Signal className="h-3.5 w-3.5" /> {countdown}s 後更新
                    </span>
                  </div>
                </div>
              ) : (
                <Skeleton className="h-16 w-full bg-white/8" />
              )}
            </CardHeader>
            <CardContent className="p-3 sm:p-5">
              {active && activeAnalysis ? (
                <>
                  <div className="mb-3 flex flex-wrap gap-4 px-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <i className="h-0.5 w-4 bg-blue-400" /> EMA 9
                    </span>
                    <span className="flex items-center gap-1.5">
                      <i className="h-0.5 w-4 bg-violet-400" /> EMA 20
                    </span>
                    <span className="flex items-center gap-1.5">
                      <i className="h-0.5 w-4 border-t border-dashed border-amber-300" />{" "}
                      {interval === "1d" ? "20 日量價均線" : "VWAP"}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <i className="h-0.5 w-4 border-t border-dashed border-cyan-300" />{" "}
                      突破位
                    </span>
                  </div>
                  <PriceChart
                    instrument={active}
                    analysis={activeAnalysis}
                    interval={interval}
                  />
                </>
              ) : loading ? (
                <Skeleton className="h-[430px] w-full bg-white/8" />
              ) : (
                <div className="grid h-[430px] place-items-center text-center">
                  <div>
                    <AlertTriangle className="mx-auto h-8 w-8 text-amber-300" />
                    <p className="mt-3 font-medium text-slate-200">
                      暫時無法繪製圖表
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {errors[selected] ?? "請稍後按更新重試"}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {active && activeAnalysis ? (
            <AnalysisPanel
              instrument={active}
              analysis={activeAnalysis}
              probability={probabilities[active.symbol]}
              probabilityLoading={probabilityLoading}
              probabilityError={probabilityErrors[active.symbol]}
              interval={interval}
            />
          ) : (
            <Skeleton className="min-h-[720px] rounded-xl bg-white/8" />
          )}
        </div>

        <footer className="mt-5 flex flex-col gap-3 rounded-xl border border-white/8 bg-[#0a1421] px-4 py-3 text-xs leading-5 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
            {dataSource}，每 30 秒更新；資料可能延遲或暫時限流，不可代替券商成交資訊。
          </p>
          <p className="shrink-0">
            {lastRefresh
              ? "最後更新 " +
                new Date(lastRefresh).toLocaleTimeString("zh-Hant", {
                  hour12: false,
                })
              : "正在連線"}
          </p>
        </footer>
      </div>
    </main>
  );
}
