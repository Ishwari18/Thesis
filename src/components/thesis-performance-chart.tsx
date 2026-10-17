"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PERIODS, type ChartPeriod, type ChartPoint, isPriceStale } from "@/lib/market-chart";
import { calculateWeightedThesisReturn, normalizeThesisIndexPoints, type ThesisIndexConstituent, type ThesisIndexMark } from "@/lib/thesis-index";
import { managePacificaPriceFeed } from "@/lib/pacifica-price-feed";

type PerformanceResponse = {
  thesis: string; period: ChartPeriod; metric: string; methodology: string; points: ChartPoint[];
  historicalAvailable: boolean; historyMessage?: string | null; status: string; currentReturn: number | null;
  missingPriceSymbols: string[]; basket: ThesisIndexConstituent[]; basePrices: Record<string, string>;
  currentPrices: Record<string, ThesisIndexMark>; websocketUrl: string | null; observedAt: string | null; message?: string;
};
type Status = "loading" | "live" | "partial" | "unavailable" | "delayed";
const percent = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const timeLabel = (timestamp: number, period: ChartPeriod) => period === "1D"
  ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  : new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric", ...(period === "ALL" ? { year: "2-digit" } : {}) });

export function ThesisPerformanceChart({ thesisSlug, thesisName }: { thesisSlug: string; thesisName: string }) {
  const [period, setPeriod] = useState<ChartPeriod>("1W");
  const [data, setData] = useState<PerformanceResponse | null>(null);
 const [points, setPoints] = useState<ChartPoint[]>([]);
const [liveReturn, setLiveReturn] = useState<number | null>(null);
const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const lastUpdateRef = useRef<number | null>(null);
  const marksRef = useRef(new Map<string, ThesisIndexMark>());
  const basketRef = useRef<ThesisIndexConstituent[]>([]);
  const basePricesRef = useRef<Record<string, string>>({});
  const pointsRef = useRef<ChartPoint[]>([]);
  const lastAddedRef = useRef(0);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/theses/${encodeURIComponent(thesisSlug)}/performance?period=${period}`, { cache: "no-store" });
    const result = await response.json() as PerformanceResponse;
    if (!response.ok) throw new Error(result.message ?? "Historical market data unavailable.");
    setData(result); setError(""); setStatus(result.status as Status);
    basketRef.current = result.basket; basePricesRef.current = result.basePrices;
    marksRef.current = new Map(Object.entries(result.currentPrices ?? {}));
    const series = normalizeThesisIndexPoints(result.points ?? []);
    pointsRef.current = series; setPoints(series);
    if (result.observedAt) lastUpdateRef.current = Date.parse(result.observedAt);
    return result;
  }, [period, thesisSlug]);

  useEffect(() => {
    let disposed = false;
    let stopFeed: (() => void) | undefined;
    let updateTimer: ReturnType<typeof setTimeout> | undefined;
    setStatus("loading"); setData(null); setPoints([]); setError("");
    pointsRef.current = []; marksRef.current.clear(); basketRef.current = []; basePricesRef.current = {}; lastUpdateRef.current = null;
    const load = async () => {
      try {
        const result = await refresh();
        if (disposed || !result.websocketUrl || !result.basket.length || !Object.keys(result.basePrices).length) return;
        stopFeed = managePacificaPriceFeed(result.websocketUrl, result.basket.map((asset) => asset.symbol), (symbol, point) => {
          marksRef.current.set(symbol, { price: String(point.value), timestamp: point.timestamp });
          lastUpdateRef.current = point.timestamp;
          if (updateTimer) return;
          updateTimer = setTimeout(() => {
            updateTimer = undefined;
            const value = calculateWeightedThesisReturn(basketRef.current, basePricesRef.current, marksRef.current);
            if (value.value === null || value.timestamp === null) { setStatus("partial"); return; }
            setLiveReturn(value.value); setStatus("live");
            if (Date.now() - lastAddedRef.current < 1_000) return;
            lastAddedRef.current = Date.now();
            const next = normalizeThesisIndexPoints([...pointsRef.current, { timestamp: value.timestamp, value: value.value }]).slice(-2_000);
            pointsRef.current = next; setPoints(next);
          }, 200);
        }, (next) => setStatus((current) => current === "partial" && next !== "live" ? current : next));
      } catch (cause) {
        if (!disposed) { setError(cause instanceof Error ? cause.message : "Historical market data unavailable."); setStatus("unavailable"); }
      }
    };
    void load();
    const refreshTimer = setInterval(() => { if (!disposed) void refresh().catch(() => setStatus("delayed")); }, 60_000);
    const staleTimer = setInterval(() => { if (isPriceStale(lastUpdateRef.current)) setStatus((value) => value === "loading" || value === "unavailable" ? value : "delayed"); }, 5_000);
    return () => { disposed = true; clearInterval(refreshTimer); clearInterval(staleTimer); if (updateTimer) clearTimeout(updateTimer); stopFeed?.(); };
  }, [period, refresh]);

  const domain = useMemo(() => {
    if (!points.length) return ["auto", "auto"] as ["auto", "auto"];
    const values = points.map((point) => point.value), min = Math.min(...values), max = Math.max(...values);
    const padding = (max - min || Math.abs(max) * .05 || .1) * .12;
    return [min - padding, max + padding] as [number, number];
  }, [points]);
  const historyVisible = Boolean(data?.historicalAvailable && points.length >= 2);
  return <section className="market-chart-section thesis-performance-chart" aria-label={`${thesisName} performance chart`}>
    <div className="market-chart-controls"><div className="period-controls" aria-label="Chart period">{PERIODS.map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
    {!historyVisible && <div className="market-chart-empty">{error || data?.historyMessage || (status === "loading" ? "Loading actual Pacifica candle history…" : "Historical constituent prices are unavailable for this period.")}</div>}
    {historyVisible && <div className="chart-wrap market-chart-wrap chart-ready"><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 18, right: 5, bottom: 0, left: -12 }}><CartesianGrid vertical={false} stroke="#252b31" strokeDasharray="2 5"/><XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => timeLabel(value, period)} axisLine={false} tickLine={false} tick={{ fill: "#77808b", fontSize: 10 }} minTickGap={32}/><YAxis orientation="right" domain={domain} tickFormatter={(value: number) => percent(value)} axisLine={false} tickLine={false} tick={{ fill: "#77808b", fontSize: 10 }} width={68} tickCount={4}/><Tooltip cursor={{ stroke: "#8c98aa", strokeDasharray: "3 4" }} contentStyle={{ background: "#11151a", border: "1px solid #303945", borderRadius: 5, fontSize: 11 }} labelFormatter={(value) => new Date(Number(value)).toLocaleString()} formatter={(value) => [percent(Number(value)), "Weighted return"]}/><Line type="monotone" dataKey="value" stroke="#f5f7fa" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: "#fff", stroke: "#fff" }} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>}
  </section>;
}
