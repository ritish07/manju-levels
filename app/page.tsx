'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  ChevronDown,
  Crosshair,
  Layers3,
  RefreshCw,
  Search,
  Settings2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

type AssetKey = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
type Side = 'CE' | 'PE';
type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1H' | '4H' | 'D' | 'M';
type Candle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: string;
};
type ChartLevel = { value: number; label: string; color: string };
type ChainLeg = {
  ltp: number;
  oi: number;
  previousOi: number;
  previousClose: number;
  securityId: number;
} | null;
type LiveSnapshot = {
  connected: boolean;
  spot: number;
  expiry: string;
  expiries: string[];
  weeklyOpen: number;
  dayOpen?: number;
  futurePrice?: number;
  futureSymbol?: string;
  futureExpiry?: string;
  selectedStrike: number;
  underlyingCandles: Candle[];
  optionCandles: Candle[];
  chain: { strike: number; ce: ChainLeg; pe: ChainLeg }[];
  updatedAt: string;
};
type NseInstrument = {
  securityId: number;
  symbol: string;
  name: string;
  segment: 'NSE_EQ';
  instrument: 'EQUITY';
};
type PaperMode = 'FORWARD' | 'BACKTEST';
type PaperPosition = {
  id: string;
  mode: PaperMode;
  status: 'OPEN' | 'CLOSED';
  openTime: string;
  closeTime: string | null;
  contract: string;
  side: Side;
  quantity: number;
  lotSize: number;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number;
  stopPrice: number;
  targetPrice: number;
  closeReason: string | null;
  signalType: string;
};
const TIMEFRAMES: Timeframe[] = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1H',
  '4H',
  'D',
  'M',
];
const INTERVAL_MINUTES: Record<Timeframe, number> = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1H': 60,
  '4H': 240,
  D: 1440,
  M: 43200,
};

const ASSETS: Record<
  AssetKey,
  {
    name: string;
    short: string;
    spot: number;
    weeklyOpen: number;
    step: number;
    change: number;
    intradayStep: number;
  }
> = {
  NIFTY: {
    name: 'NIFTY 50',
    short: 'NIFTY',
    spot: 25114.0,
    weeklyOpen: 25114.0,
    step: 50,
    change: 0.42,
    intradayStep: 59.65,
  },
  BANKNIFTY: {
    name: 'NIFTY BANK',
    short: 'BANK NIFTY',
    spot: 54886.35,
    weeklyOpen: 57343.3,
    step: 100,
    change: -0.18,
    intradayStep: 118,
  },
  SENSEX: {
    name: 'BSE SENSEX',
    short: 'SENSEX',
    spot: 81721.08,
    weeklyOpen: 81721.08,
    step: 100,
    change: 0.31,
    intradayStep: 236,
  },
};

function seeded(seed: number) {
  let s = seed;
  return () => ((s = Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296;
}
function makeCandles(
  base: number,
  seed: number,
  option = false,
  timeframe: Timeframe = '5m',
): Candle[] {
  const interval = INTERVAL_MINUTES[timeframe];
  const tfSeed = TIMEFRAMES.indexOf(timeframe) * 7919;
  const rnd = seeded(seed + tfSeed);
  let last = base * (0.992 + rnd() * 0.012);
  const scale = Math.sqrt(Math.max(interval / 5, 0.2));
  const volatility =
    (option ? Math.max(base * 0.055, 1.8) : base * 0.00055) * scale;
  return Array.from({ length: 180 }, (_, i) => {
    const drift =
      Math.sin(i / 8) * volatility * 0.18 + (i > 58 ? volatility * 0.08 : 0);
    const open = last;
    const close = Math.max(
      option ? 2 : 1,
      open + (rnd() - 0.47) * volatility + drift,
    );
    const high = Math.max(open, close) + rnd() * volatility * 0.65;
    const low = Math.max(
      0.1,
      Math.min(open, close) - rnd() * volatility * 0.65,
    );
    last = close;
    const totalMinutes = 9 * 60 + 15 + i * interval;
    const time =
      timeframe === 'M'
        ? new Date(2026, i % 12, 1).toLocaleDateString('en-IN', {
            month: 'short',
            year: '2-digit',
          })
        : timeframe === 'D'
          ? `${String((i % 28) + 1).padStart(2, '0')} Sep`
          : `${String(Math.floor((totalMinutes / 60) % 24)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
    return { open, high, low, close, volume: 24 + rnd() * 76, time };
  });
}
function formatPrice(n: number) {
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function formatOi(n: number) {
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(2)} M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(2)} K`;
  return Math.round(n).toLocaleString('en-IN');
}
function formatCurrency(n: number) {
  return n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function formatExpiry(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || 'Loading';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

function targetLabel(step: number) {
  return `T${Number.isInteger(step) ? step : step.toFixed(1)}`;
}

function makeOptionLevels(open: number): ChartLevel[] {
  const halfStep = 1.5 * Math.sqrt(open);
  const resistance = Array.from({ length: 16 }, (_, i) => ({
    value: open + (i + 1) * halfStep,
    label: targetLabel(1 + i * 0.5),
    color: '#d94b52',
  }));
  const support = Array.from({ length: 16 }, (_, i) => ({
    value: open - (i + 1) * halfStep,
    label: targetLabel(1 + i * 0.5),
    color: '#2e9b67',
  })).filter((level) => level.value > 0);
  return [...resistance, ...support];
}

function makeWeeklyLevels(open: number): ChartLevel[] {
  const root = Math.sqrt(open);
  const resistancePrimary = Array.from(
    { length: 7 },
    (_, i) => (root + i + 1) ** 2,
  );
  const supportPrimary = Array.from(
    { length: 7 },
    (_, i) => (root - i - 1) ** 2,
  );
  const withMidpoints = (values: number[], color: string) =>
    values.flatMap((value, i) => [
      { value, label: targetLabel(i + 1), color },
      ...(i < values.length - 1
        ? [
            {
              value: (value + values[i + 1]) / 2,
              label: targetLabel(i + 1.5),
              color,
            },
          ]
        : []),
    ]);
  const resistance = withMidpoints(resistancePrimary, '#d94b52');
  const support = withMidpoints(supportPrimary, '#2e9b67');
  return [...resistance, ...support];
}

function makeIntradayLevels(open: number, step: number): ChartLevel[] {
  const side = (direction: 1 | -1, color: string) =>
    Array.from({ length: 17 }, (_, i) => {
      const target = 1 + i * 0.5;
      return {
        value: open + direction * target * step,
        label: targetLabel(target),
        color,
      };
    });
  return [
    ...side(1, '#d94b52'),
    ...side(-1, '#2e9b67').filter((level) => level.value > 0),
  ];
}

function ResizeHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const lastX = useRef<number | null>(null);
  return (
    <div
      className="pane-divider"
      onPointerDown={(e) => {
        lastX.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (lastX.current === null) return;
        const delta = e.clientX - lastX.current;
        lastX.current = e.clientX;
        onDrag(delta);
      }}
      onPointerUp={() => (lastX.current = null)}
      onPointerCancel={() => (lastX.current = null)}
    >
      <span />
    </div>
  );
}

function EmptyPane() {
  return (
    <section className="empty-panel">
      <div>
        <strong>Index options unavailable for stocks</strong>
        <span>
          Select Nifty, Bank Nifty, or Sensex to view its option chart and
          chain.
        </span>
      </div>
    </section>
  );
}

function Chart({
  title,
  subtitle,
  candles,
  levels,
  accent = false,
}: {
  title: string;
  subtitle: string;
  candles: Candle[];
  levels: ChartLevel[];
  accent?: boolean;
}) {
  const priceClipId = `price-plot-${useId().replace(/:/g, '')}`;
  const [zoom, setZoom] = useState(1);
  const [yZoom, setYZoom] = useState(1);
  const [offset, setOffset] = useState(0);
  const [yOffset, setYOffset] = useState(0);
  const [cross, setCross] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<
    | (
        | {
            mode: 'pan';
            x: number;
            y: number;
            offset: number;
            yOffset: number;
            range: number;
          }
        | { mode: 'x-scale'; x: number; offset: number; zoom: number }
        | { mode: 'y-scale'; y: number; yZoom: number }
      )
    | null
  >(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 760, height: 480 });
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () =>
      setSize({
        width: Math.max(320, stage.clientWidth),
        height: Math.max(300, stage.clientHeight),
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const width = size.width,
    height = size.height,
    plotH = height - 118,
    timeAxisTop = height - 42,
    padL = 10,
    padR = 94;
  const visibleCount = Math.min(
    candles.length,
    Math.max(24, Math.floor(92 / zoom)),
  );
  const minOffset = -Math.floor(visibleCount * 0.65);
  const maxOffset = Math.max(0, candles.length - visibleCount);
  const panCeil = Math.ceil(offset);
  const start = Math.max(0, candles.length - visibleCount - panCeil);
  const view = candles.slice(start, start + visibleCount + 1);
  const vals = candles
    .flatMap((c) => [c.high, c.low])
    .concat(levels.map((level) => level.value));
  const dataMin = Math.min(...vals),
    dataMax = Math.max(...vals),
    dataRange = Math.max(dataMax - dataMin, 1);
  const midpoint = (dataMax + dataMin) / 2 + yOffset;
  const range = dataRange / yZoom;
  const min = midpoint - range / 2,
    max = midpoint + range / 2;
  const y = (v: number) => 18 + ((max - v) / range) * (plotH - 36);
  const plotW = width - padL - padR;
  const slot = plotW / visibleCount;
  const panShift = (offset - panCeil) * slot;
  const body = Math.max(2.5, Math.min(8, slot * 0.58));
  const latest = candles[candles.length - 1];
  const up = latest.close >= latest.open;
  const yTickCount = Math.max(6, Math.floor(plotH / 56));
  const xTickCount = Math.max(4, Math.floor(plotW / 105));
  const crossIndex = cross
    ? Math.round((cross.x - padL - slot / 2 - panShift) / slot)
    : -1;
  const crossCandle =
    crossIndex >= 0 && crossIndex < view.length ? view[crossIndex] : null;
  const crossX = crossCandle
    ? padL + crossIndex * slot + slot / 2 + panShift
    : (cross?.x ?? 0);
  const crossPrice = cross
    ? max - ((cross.y - 18) / Math.max(plotH - 36, 1)) * range
    : 0;
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY))
      setOffset((v) =>
        Math.min(maxOffset, Math.max(minOffset, v + e.deltaX / 12)),
      );
    else
      setZoom((v) =>
        Math.min(5, Math.max(0.65, v * (e.deltaY > 0 ? 0.9 : 1.12))),
      );
  };
  return (
    <section className={`chart-panel ${accent ? 'active-chart' : ''}`}>
      <div className="chart-head">
        <div>
          <div className="chart-title">
            <span className="symbol-mark">{title.slice(0, 1)}</span>
            {title}
          </div>
          <div className="chart-sub">
            {subtitle}{' '}
            <span className={up ? 'positive' : 'negative'}>
              O {formatPrice(latest.open)} H {formatPrice(latest.high)} L{' '}
              {formatPrice(latest.low)} C {formatPrice(latest.close)}
            </span>
          </div>
        </div>
        <div className="chart-tools">
          <button
            aria-label="Zoom out"
            onClick={() => setZoom((v) => Math.max(0.65, v / 1.25))}
          >
            <ZoomOut />
          </button>
          <button
            aria-label="Zoom in"
            onClick={() => setZoom((v) => Math.min(5, v * 1.25))}
          >
            <ZoomIn />
          </button>
          <button
            aria-label="Reset chart"
            onClick={() => {
              setZoom(1);
              setYZoom(1);
              setOffset(0);
              setYOffset(0);
            }}
          >
            <RefreshCw />
          </button>
        </div>
      </div>
      <div
        ref={stageRef}
        className="chart-stage"
        style={{ backgroundColor: '#ffffff' }}
      >
        <svg
          style={{ backgroundColor: '#ffffff' }}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          onWheel={onWheel}
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * width,
              py = ((e.clientY - rect.top) / rect.height) * height;
            drag.current =
              x > plotW && py < timeAxisTop
                ? { mode: 'y-scale', y: e.clientY, yZoom }
                : py > timeAxisTop
                  ? { mode: 'x-scale', x: e.clientX, offset, zoom }
                  : {
                      mode: 'pan',
                      x: e.clientX,
                      y: e.clientY,
                      offset,
                      yOffset,
                      range,
                    };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * width,
              py = ((e.clientY - rect.top) / rect.height) * height;
            e.currentTarget.style.cursor =
              x > plotW && py < timeAxisTop
                ? 'ns-resize'
                : py > timeAxisTop
                  ? 'ew-resize'
                  : drag.current?.mode === 'pan'
                    ? 'grabbing'
                    : 'crosshair';
            setCross({ x, y: py });
            if (drag.current?.mode === 'pan') {
              setOffset(
                Math.min(
                  maxOffset,
                  Math.max(
                    minOffset,
                    drag.current.offset +
                      ((e.clientX - drag.current.x) * visibleCount) / plotW,
                  ),
                ),
              );
              setYOffset(
                drag.current.yOffset +
                  ((e.clientY - drag.current.y) * drag.current.range) /
                    Math.max(plotH - 36, 1),
              );
            }
            if (drag.current?.mode === 'x-scale')
              setZoom(
                Math.min(
                  5,
                  Math.max(
                    0.65,
                    drag.current.zoom *
                      Math.exp((drag.current.x - e.clientX) / 240),
                  ),
                ),
              );
            if (drag.current?.mode === 'y-scale')
              setYZoom(
                Math.min(
                  5,
                  Math.max(
                    0.55,
                    drag.current.yZoom *
                      Math.exp((drag.current.y - e.clientY) / 220),
                  ),
                ),
              );
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerLeave={(e) => {
            drag.current = null;
            setCross(null);
            e.currentTarget.style.cursor = 'crosshair';
          }}
        >
          <defs>
            <clipPath id={priceClipId}>
              <rect x="0" y="0" width={plotW + padL} height={plotH} />
            </clipPath>
          </defs>
          {Array.from({ length: 10 }, (_, i) => (
            <line
              key={`v-${i}`}
              x1={padL + (i * plotW) / 9}
              x2={padL + (i * plotW) / 9}
              y1={0}
              y2={plotH}
              stroke="#eceff1"
              strokeWidth="1"
            />
          ))}
          {Array.from({ length: 8 }, (_, i) => (
            <line
              key={`h-${i}`}
              x1={0}
              x2={plotW + padL}
              y1={(i * plotH) / 7}
              y2={(i * plotH) / 7}
              stroke="#eceff1"
              strokeWidth="1"
            />
          ))}
          {Array.from({ length: yTickCount }, (_, i) => {
            const t = i / (yTickCount - 1);
            return (
              <text
                key={i}
                x={width - padR + 8}
                y={22 + t * (plotH - 36)}
                className="axis-label"
              >
                {formatPrice(max - t * range)}
              </text>
            );
          })}
          {levels.map((level) => {
            const levelY = y(level.value);
            const isOpenLevel = level.label === 'OPEN';
            return levelY >= 0 && levelY <= plotH ? (
              <g key={`${level.color}-${level.label}-${level.value}`}>
                <line
                  x1={0}
                  y1={levelY}
                  x2={width - padR}
                  y2={levelY}
                  stroke={level.color}
                  strokeWidth={isOpenLevel ? '2' : '1.5'}
                  strokeDasharray={isOpenLevel ? undefined : '5 4'}
                />
                <text
                  x={plotW - 8}
                  y={Math.max(12, levelY - 5)}
                  textAnchor="end"
                  className="target-label"
                  fill={level.color}
                >
                  {level.label}
                </text>
                <rect
                  x={width - padR - 1}
                  y={levelY - 10}
                  width="80"
                  height="20"
                  rx="3"
                  fill={level.color}
                />
                <text
                  x={width - 20}
                  y={levelY + 4}
                  textAnchor="end"
                  className="level-label"
                >
                  {formatPrice(level.value)}
                </text>
              </g>
            ) : null;
          })}
          {view.map((c, i) => {
            const cx = padL + i * slot + slot / 2 + panShift;
            const green = c.close >= c.open;
            const color = green ? '#089981' : '#f23645';
            return (
              <g key={start + i}>
                <g clipPath={`url(#${priceClipId})`}>
                  <line
                    x1={cx}
                    x2={cx}
                    y1={y(c.high)}
                    y2={y(c.low)}
                    stroke={color}
                    strokeWidth="1.2"
                  />
                  <rect
                    x={cx - body / 2}
                    y={Math.min(y(c.open), y(c.close))}
                    width={body}
                    height={Math.max(1.5, Math.abs(y(c.open) - y(c.close)))}
                    fill={color}
                    stroke={color}
                    strokeWidth="1.2"
                  />
                </g>
                <rect
                  x={cx - body / 2}
                  y={plotH + 10 + (1 - c.volume / 100) * 54}
                  width={body}
                  height={(c.volume / 100) * 54}
                  fill={green ? '#8bd8ca' : '#ffadb4'}
                  opacity=".82"
                />
              </g>
            );
          })}
          {cross && cross.x < plotW && cross.y >= 0 && cross.y < plotH && (
            <g className="crosshair">
              <line x1={crossX} x2={crossX} y1={0} y2={timeAxisTop} />
              <line x1={0} x2={plotW} y1={cross.y} y2={cross.y} />
              <rect
                className="crosshair-label-bg"
                x={width - padR - 1}
                y={Math.max(1, Math.min(plotH - 23, cross.y - 11))}
                width="80"
                height="22"
                rx="3"
              />
              <text
                className="crosshair-label"
                x={width - 20}
                y={Math.max(16, Math.min(plotH - 8, cross.y + 4))}
                textAnchor="end"
              >
                {formatPrice(crossPrice)}
              </text>
              {crossCandle && (
                <>
                  <rect
                    className="crosshair-label-bg"
                    x={Math.max(2, Math.min(plotW - 68, crossX - 34))}
                    y={timeAxisTop + 5}
                    width="68"
                    height="27"
                    rx="3"
                  />
                  <text
                    className="crosshair-label"
                    x={Math.max(36, Math.min(plotW - 34, crossX))}
                    y={timeAxisTop + 23}
                    textAnchor="middle"
                  >
                    {crossCandle.time}
                  </text>
                </>
              )}
            </g>
          )}
          <line
            x1={0}
            x2={plotW + padL}
            y1={timeAxisTop}
            y2={timeAxisTop}
            stroke="#e2e5e8"
            strokeWidth="1"
          />
          {Array.from({ length: xTickCount }, (_, i) => {
            const t = i / (xTickCount - 1);
            const ix = Math.floor(t * visibleCount - panShift / slot);
            const label = ix >= 0 && ix < view.length ? view[ix].time : '';
            return (
              <text
                key={i}
                x={padL + t * plotW}
                y={height - 15}
                textAnchor={
                  i === 0 ? 'start' : i === xTickCount - 1 ? 'end' : 'middle'
                }
                className="axis-label"
              >
                {label}
              </text>
            );
          })}
        </svg>
      </div>
      <div className="chart-foot">
        <span>
          <Activity /> Levels active · Formula preview
        </span>
        <span>Scroll to zoom · Drag to pan</span>
      </div>
    </section>
  );
}

function PositionsView({
  mode,
  onModeChange,
  positions,
  engineStatus,
}: {
  mode: PaperMode;
  onModeChange: (mode: PaperMode) => void;
  positions: PaperPosition[];
  engineStatus: string;
}) {
  const startingCapital = 100000;
  const visiblePositions = positions.filter((position) => position.mode === mode);
  const realizedPnl = visiblePositions
    .filter((position) => position.status === 'CLOSED')
    .reduce((total, position) => total + position.pnl, 0);
  const openPnl = visiblePositions
    .filter((position) => position.status === 'OPEN')
    .reduce((total, position) => total + position.pnl, 0);
  const usedCapital = visiblePositions
    .filter((position) => position.status === 'OPEN')
    .reduce(
      (total, position) => total + position.entryPrice * position.quantity,
      0,
    );
  const availableCapital = startingCapital + realizedPnl - usedCapital;

  return (
    <section className="positions-view">
      <div className="positions-hero">
        <div>
          <span className="eyebrow">PAPER TESTING</span>
          <h1>Positions</h1>
          <p>Review simulated option trades and capital performance.</p>
        </div>
        <div className="paper-mode" role="tablist" aria-label="Paper testing mode">
          <button
            role="tab"
            aria-selected={mode === 'FORWARD'}
            className={mode === 'FORWARD' ? 'active' : ''}
            onClick={() => onModeChange('FORWARD')}
          >
            Forward test
          </button>
          <button
            role="tab"
            aria-selected={mode === 'BACKTEST'}
            className={mode === 'BACKTEST' ? 'active' : ''}
            onClick={() => onModeChange('BACKTEST')}
          >
            Backtest
          </button>
        </div>
      </div>

      <div className="capital-grid">
        <article>
          <span>Starting capital</span>
          <strong>{formatCurrency(startingCapital)}</strong>
          <small>Demo account</small>
        </article>
        <article>
          <span>Available capital</span>
          <strong>{formatCurrency(availableCapital)}</strong>
          <small>{usedCapital ? `${formatCurrency(usedCapital)} deployed` : 'No capital deployed'}</small>
        </article>
        <article>
          <span>Realized P&amp;L</span>
          <strong className={realizedPnl >= 0 ? 'positive' : 'negative'}>{formatCurrency(realizedPnl)}</strong>
          <small>{visiblePositions.filter((position) => position.status === 'CLOSED').length} closed trades</small>
        </article>
        <article>
          <span>Open P&amp;L</span>
          <strong className={openPnl >= 0 ? 'positive' : 'negative'}>{formatCurrency(openPnl)}</strong>
          <small>{visiblePositions.filter((position) => position.status === 'OPEN').length} open positions</small>
        </article>
      </div>

      <div className="positions-ledger">
        <header>
          <div>
            <h2>{mode === 'FORWARD' ? 'Forward-test positions' : 'Backtest positions'}</h2>
            <span>Strategy execution ledger</span>
          </div>
          <span className={`engine-state ${engineStatus === 'Monitoring live data' ? 'active' : ''}`}><i /> {engineStatus}</span>
        </header>
        <div className="position-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Open time</th>
                <th>Close time</th>
                <th>Option contract</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>Lot size</th>
                <th>Entry</th>
                <th>Stop</th>
                <th>Target</th>
                <th>Exit</th>
                <th>P&amp;L</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {visiblePositions.map((position) => (
                <tr key={position.id}>
                  <td><span className={`position-status ${position.status.toLowerCase()}`}>{position.status}</span></td>
                  <td>{position.openTime}</td>
                  <td>{position.closeTime || '—'}</td>
                  <td><strong>{position.contract}</strong></td>
                  <td>{position.side}</td>
                  <td>{position.quantity.toLocaleString('en-IN')}</td>
                  <td>{position.lotSize.toLocaleString('en-IN')}</td>
                  <td>{formatPrice(position.entryPrice)}</td>
                  <td className="negative">{formatPrice(position.stopPrice)}</td>
                  <td className="positive">{formatPrice(position.targetPrice)}</td>
                  <td>{position.exitPrice === null ? '—' : formatPrice(position.exitPrice)}</td>
                  <td className={position.pnl >= 0 ? 'positive' : 'negative'}>{formatCurrency(position.pnl)}</td>
                  <td>{position.closeReason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visiblePositions.length && (
            <div className="positions-empty">
              <span><BriefcaseBusiness /></span>
              <strong>No paper positions yet</strong>
              <p>The engine is monitoring the two-strikes-ITM CE and PE contracts. Valid T3 trades will appear here automatically.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const [appView, setAppView] = useState<'MARKET' | 'POSITIONS'>('MARKET');
  const [paperMode, setPaperMode] = useState<PaperMode>('FORWARD');
  const [paperPositions, setPaperPositions] = useState<PaperPosition[]>([]);
  const [paperEngineStatus, setPaperEngineStatus] = useState('Waiting for Dhan credentials');
  const [asset, setAsset] = useState<AssetKey>('NIFTY');
  const [side, setSide] = useState<Side>('CE');
  const [selectedStrike, setSelectedStrike] = useState(25100);
  const [expiry, setExpiry] = useState('');
  const [chainView, setChainView] = useState<'ALL' | 'CALLS' | 'PUTS'>('ALL');
  const [showLevels, setShowLevels] = useState(true);
  const [levelMode, setLevelMode] = useState<'INTRADAY' | 'WEEKLY'>('WEEKLY');
  const [showSpot, setShowSpot] = useState(true);
  const [levelPopoverStrike, setLevelPopoverStrike] = useState<number | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [chainPercent, setChainPercent] = useState(28);
  const [chartSplit, setChartSplit] = useState(50);
  const [live, setLive] = useState<LiveSnapshot | null>(null);
  const [feedError, setFeedError] = useState('Connecting to Dhan');
  const [instruments, setInstruments] = useState<NseInstrument[]>([]);
  const [selectedStock, setSelectedStock] = useState<NseInstrument | null>(
    null,
  );
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [symbolSearch, setSymbolSearch] = useState('');
  const [symbolFilter, setSymbolFilter] = useState<'ALL' | 'INDICES' | 'STOCKS'>('ALL');
  const meta = ASSETS[asset];
  const currentSpot = live?.spot || (selectedStock ? 0 : meta.spot);
  const atm = Math.round(currentSpot / meta.step) * meta.step;
  useEffect(() => {
    fetch('/api/dhan/instruments')
      .then((response) => response.json())
      .then((data: any) => setInstruments(data.instruments || []))
      .catch(() => setInstruments([]));
  }, []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const assets: AssetKey[] = ['NIFTY', 'BANKNIFTY', 'SENSEX'];
    let index = 0;
    const run = async () => {
      try {
        const response = await fetch(`/api/paper/tick?asset=${assets[index]}`, {
          method: 'POST',
          cache: 'no-store',
        });
        const data: any = await response.json();
        if (!active) return;
        setPaperEngineStatus(response.ok ? 'Monitoring live data' : data.error || 'Engine unavailable');
        index = (index + 1) % assets.length;
      } catch {
        if (active) setPaperEngineStatus('Engine unavailable');
      } finally {
        if (active) timer = setTimeout(run, 10000);
      }
    };
    run();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch('/api/paper/positions', { cache: 'no-store' });
        const data: any = await response.json();
        if (active && response.ok) setPaperPositions(data.positions || []);
      } finally {
        if (active) timer = setTimeout(load, 5000);
      }
    };
    load();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const query = new URLSearchParams({
          asset,
          timeframe,
          side,
          strike: String(selectedStrike),
        });
        if (selectedStock) {
          query.set('securityId', String(selectedStock.securityId));
          query.set('symbol', selectedStock.symbol);
        }
        if (expiry) query.set('expiry', expiry);
        const response = await fetch(`/api/dhan/snapshot?${query}`, {
          cache: 'no-store',
        });
        const data: any = await response.json();
        if (!response.ok)
          throw new Error(data.error || 'Dhan feed unavailable');
        if (!active) return;
        setLive(data);
        setFeedError('');
        if (data.expiry && data.expiry !== expiry) setExpiry(data.expiry);
      } catch (error) {
        if (active) {
          setLive(null);
          setFeedError(
            error instanceof Error ? error.message : 'Dhan feed unavailable',
          );
        }
      } finally {
        if (active) timer = setTimeout(load, 4000);
      }
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [asset, timeframe, side, selectedStrike, expiry, selectedStock]);
  const mockStrikes = useMemo(
    () => Array.from({ length: 13 }, (_, i) => atm + (i - 6) * meta.step),
    [atm, meta.step],
  );
  const mockUnderlying = useMemo(
    () => makeCandles(meta.spot, meta.spot, false, timeframe),
    [meta, timeframe],
  );
  const distance = Math.abs(selectedStrike - atm) / meta.step;
  const optionBase = Math.max(
    22,
    176 -
      distance * 21 +
      (side === 'CE'
        ? ((atm - selectedStrike) / meta.step) * 12
        : ((selectedStrike - atm) / meta.step) * 12),
  );
  const mockOptionCandles = useMemo(
    () =>
      makeCandles(
        optionBase,
        selectedStrike + (side === 'CE' ? 7 : 19),
        true,
        timeframe,
      ),
    [optionBase, selectedStrike, side, timeframe],
  );
  const underlying = live?.underlyingCandles?.length
    ? live.underlyingCandles
    : mockUnderlying;
  const optionCandles = live?.optionCandles?.length
    ? live.optionCandles
    : mockOptionCandles;
  const weeklyOpen = live?.weeklyOpen || meta.weeklyOpen;
  const dayOpen = live?.dayOpen || meta.spot;
  const underlyingLevels = selectedStock
    ? []
    : levelMode === 'WEEKLY'
      ? makeWeeklyLevels(weeklyOpen)
      : makeIntradayLevels(dayOpen, meta.intradayStep);
  const underlyingOpen = levelMode === 'WEEKLY' ? weeklyOpen : dayOpen;
  const underlyingChartLevels = [
    ...underlyingLevels,
    { value: underlyingOpen, label: 'OPEN', color: '#f28c18' },
  ];
  const optionOpen = optionCandles[0].open;
  const optionLevels = makeOptionLevels(optionOpen);
  const optionChartLevels = [
    ...optionLevels,
    { value: optionOpen, label: 'OPEN', color: '#f28c18' },
  ];
  const optionLast = optionCandles.at(-1)?.close ?? optionOpen;
  const immediateSupport = optionLevels
    .filter((level) => level.value < optionLast)
    .sort((a, b) => b.value - a.value)[0];
  const immediateResistance = optionLevels
    .filter((level) => level.value > optionLast)
    .sort((a, b) => a.value - b.value)[0];
  const optionContractReady = !live || live.selectedStrike === selectedStrike;
  const chainRows = live?.chain?.length
    ? live.chain.filter((row) => Math.abs(row.strike - atm) <= meta.step * 6)
    : mockStrikes.map((strike) => ({ strike, ce: null, pe: null }));
  const oiSeries = chainRows.map((row, i) => ({
    ce: row.ce?.oi ?? Math.round(42000 + Math.abs(i - 6) * 14500 + i * 1900),
    pe: row.pe?.oi ?? Math.round(51000 + Math.abs(i - 6) * 12800 + (12 - i) * 2300),
    cePrevious:
      row.ce?.previousOi ?? Math.round(27000 + Math.abs(i - 6) * 9200),
    pePrevious:
      row.pe?.previousOi ?? Math.round(31000 + Math.abs(i - 6) * 8100),
  }));
  const maxVisibleOi = Math.max(
    1,
    ...oiSeries.flatMap((row) => [row.ce, row.pe]),
  );
  const symbolResults = useMemo(() => {
    const query = symbolSearch.trim().toLowerCase();
    const indices = (Object.keys(ASSETS) as AssetKey[]).map((key) => ({
      kind: 'INDICES' as const,
      value: key,
      symbol: key,
      name: ASSETS[key].name,
      exchange: key === 'SENSEX' ? 'BSE' : 'NSE',
    }));
    const stocks = instruments.map((item) => ({
      kind: 'STOCKS' as const,
      value: `${item.symbol} — ${item.name}`,
      symbol: item.symbol,
      name: item.name,
      exchange: 'NSE',
    }));
    return [...indices, ...stocks]
      .filter((item) => symbolFilter === 'ALL' || item.kind === symbolFilter)
      .filter(
        (item) =>
          !query ||
          item.symbol.toLowerCase().includes(query) ||
          item.name.toLowerCase().includes(query),
      )
      .slice(0, 80);
  }, [instruments, symbolFilter, symbolSearch]);
  const chooseAsset = (value: AssetKey) => {
    setSelectedStock(null);
    setAsset(value);
    const next = ASSETS[value];
    setSelectedStrike(Math.round(next.spot / next.step) * next.step);
    setSymbolSearchOpen(false);
    setSymbolSearch('');
  };
  const chooseInstrument = (value: string) => {
    if ((Object.keys(ASSETS) as AssetKey[]).includes(value as AssetKey)) {
      chooseAsset(value as AssetKey);
      return;
    }
    const stock = instruments.find(
      (item) =>
        `${item.symbol} — ${item.name}` === value || item.symbol === value,
    );
    if (stock) {
      setSelectedStock(stock);
      setShowSpot(true);
      setLive(null);
      setExpiry('');
    }
    setSymbolSearchOpen(false);
    setSymbolSearch('');
  };
  useEffect(() => {
    if (!symbolSearchOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSymbolSearchOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [symbolSearchOpen]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-strike-popover]')) setLevelPopoverStrike(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <main className="app-shell">
      {symbolSearchOpen && (
        <div
          className="symbol-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSymbolSearchOpen(false);
          }}
        >
          <section className="symbol-modal" role="dialog" aria-modal="true" aria-labelledby="symbol-search-title">
            <header>
              <h2 id="symbol-search-title">Symbol search</h2>
              <button aria-label="Close symbol search" onClick={() => setSymbolSearchOpen(false)}><X /></button>
            </header>
            <label className="symbol-search-field">
              <Search />
              <input
                autoFocus
                value={symbolSearch}
                onChange={(event) => setSymbolSearch(event.target.value)}
                placeholder="Search NSE symbol or company"
              />
              {symbolSearch && <button aria-label="Clear search" onClick={() => setSymbolSearch('')}><X /></button>}
            </label>
            <div className="symbol-filters" role="tablist" aria-label="Symbol type">
              {(['ALL', 'INDICES', 'STOCKS'] as const).map((filter) => (
                <button key={filter} role="tab" aria-selected={symbolFilter === filter} className={symbolFilter === filter ? 'active' : ''} onClick={() => setSymbolFilter(filter)}>
                  {filter === 'ALL' ? 'All' : filter === 'INDICES' ? 'Indices' : 'Stocks'}
                </button>
              ))}
            </div>
            <div className="symbol-results">
              {symbolResults.map((item) => (
                <button key={`${item.kind}-${item.value}`} onClick={() => chooseInstrument(item.value)}>
                  <span className="symbol-result-mark">{item.symbol.slice(0, 1)}</span>
                  <strong>{item.symbol}</strong>
                  <span className="symbol-result-name">{item.name}</span>
                  <small>{item.kind === 'INDICES' ? 'index' : 'stock'} · {item.exchange}</small>
                </button>
              ))}
              {!symbolResults.length && <div className="symbol-empty">No matching NSE symbols</div>}
            </div>
            <footer>Search by NSE symbol or company name</footer>
          </section>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <span className="brand-glyph">M</span>
          <div>
            <strong>MANJU</strong>
            <small>LEVELS</small>
          </div>
        </div>
        <div className="asset-picker">
          <span className="eyebrow">UNDERLYING</span>
          <button className="symbol-trigger" onClick={() => setSymbolSearchOpen(true)} aria-haspopup="dialog">
            <span>{selectedStock ? selectedStock.symbol : asset}</span>
            <ChevronDown />
          </button>
        </div>
        <label className="timeframe-picker">
          <span>TIMEFRAME</span>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
          >
            {TIMEFRAMES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <ChevronDown />
        </label>
        <label className="timeframe-picker level-mode-picker">
          <span>LEVEL BASIS</span>
          <select value={levelMode} onChange={(event) => setLevelMode(event.target.value as 'INTRADAY' | 'WEEKLY')}>
            <option value="INTRADAY">Intraday</option>
            <option value="WEEKLY">Weekly</option>
          </select>
          <ChevronDown />
        </label>
        <div className="market-quote">
          <strong>{formatPrice(currentSpot)}</strong>
          <span className={meta.change >= 0 ? 'positive' : 'negative'}>
            {meta.change >= 0 ? '+' : ''}
            {meta.change.toFixed(2)}%
          </span>
          {!selectedStock && (
            <span className={`future-quote ${live?.futurePrice ? '' : 'unavailable'}`} title={live?.futureSymbol || 'Available when Dhan is connected'}>
              <small>{meta.short} FUT</small>
              <b>{live?.futurePrice ? formatPrice(live.futurePrice) : '—'}</b>
            </span>
          )}
          <span className={`live ${live ? '' : 'offline'}`}>
            <i /> {live ? 'MARKET LIVE' : 'DEMO DATA'}
          </span>
        </div>
        <div className="header-actions">
          <button
            className={`levels-toggle ${showSpot ? 'on' : ''}`}
            role="switch"
            aria-checked={showSpot}
            disabled={Boolean(selectedStock)}
            title={selectedStock ? 'Spot chart remains visible for stocks' : 'Show or hide spot chart'}
            onClick={() => setShowSpot((value) => !value)}
          >
            <span />
            Spot
          </button>
          <button
            className={`levels-toggle ${showLevels ? 'on' : ''}`}
            role="switch"
            aria-checked={showLevels}
            onClick={() => setShowLevels((value) => !value)}
          >
            <span />
            Levels
          </button>
          <span
            className={`data-source ${live ? 'connected' : 'disconnected'}`}
            title={feedError}
          >
            {live ? 'Dhan connected' : 'Dhan setup required'}
          </span>
          <button
            className={`positions-nav ${appView === 'POSITIONS' ? 'active' : ''}`}
            aria-current={appView === 'POSITIONS' ? 'page' : undefined}
            onClick={() => setAppView((view) => view === 'POSITIONS' ? 'MARKET' : 'POSITIONS')}
          >
            <BriefcaseBusiness />
            {appView === 'POSITIONS' ? 'Charts' : 'Positions'}
          </button>
          <button aria-label="Settings">
            <Settings2 />
          </button>
          <div className="avatar">RG</div>
        </div>
      </header>
      {appView === 'MARKET' ? <div
        className="workspace"
        style={{
          gridTemplateColumns: showSpot
            ? `${100 - chainPercent}fr 6px ${chainPercent}fr`
            : '50fr 6px 50fr',
        }}
      >
        <div
          className="charts-grid"
          style={{
            gridTemplateColumns: showSpot
              ? `${chartSplit}fr 6px ${100 - chartSplit}fr`
              : '1fr',
          }}
        >
          {showSpot && <Chart
            title={
              selectedStock
                ? `${selectedStock.symbol} · ${selectedStock.name}`
                : meta.name
            }
            subtitle={`${timeframe} · ${selectedStock ? 'NSE' : `NSE · ${levelMode === 'WEEKLY' ? 'Weekly' : 'Day'} open ${formatPrice(levelMode === 'WEEKLY' ? weeklyOpen : dayOpen)}`}`}
            candles={underlying}
            levels={showLevels ? underlyingChartLevels : []}
          />}
          {showSpot && <ResizeHandle
            onDrag={(delta) =>
              setChartSplit((value) =>
                Math.min(
                  78,
                  Math.max(
                    22,
                    value +
                      (delta /
                        Math.max(
                          (window.innerWidth * (100 - chainPercent)) / 100,
                          1,
                        )) *
                        100,
                  ),
                ),
              )
            }
          />}
          {selectedStock ? (
            <EmptyPane />
          ) : (
            <Chart
              title={`${meta.short} ${formatExpiry(expiry)} ${selectedStrike.toLocaleString('en-IN')} ${side}`}
              subtitle={`${timeframe} · NSE F&O`}
              candles={optionCandles}
              levels={showLevels ? optionChartLevels : []}
              accent
            />
          )}
        </div>
        <ResizeHandle
          onDrag={(delta) =>
            setChainPercent((value) =>
              Math.min(
                45,
                Math.max(
                  20,
                  value - (delta / Math.max(window.innerWidth, 1)) * 100,
                ),
              ),
            )
          }
        />
        <aside className="chain-panel">
          {selectedStock && (
            <div className="stock-chain-disabled">
              <strong>No index option chain</strong>
              <span>Choose an index to restore derivatives.</span>
            </div>
          )}
          <div className="chain-head">
            <div>
              <span className="eyebrow">DERIVATIVES</span>
              <h2>Option chain</h2>
            </div>
            <button aria-label="Refresh chain">
              <RefreshCw />
            </button>
          </div>
          <div className="chain-controls">
            <label>
              <span>Expiry</span>
              <select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              >
                {!live?.expiries?.length && <option value="">Loading</option>}
                {live?.expiries?.map((value) => (
                  <option key={value} value={value}>
                    {formatExpiry(value)}
                  </option>
                ))}
              </select>
            </label>
            <div className="segmented">
              {(['ALL', 'CALLS', 'PUTS'] as const).map((v) => (
                <button
                  key={v}
                  className={chainView === v ? 'active' : ''}
                  onClick={() => setChainView(v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="chain-summary">
            <span>
              <b>{formatPrice(currentSpot)}</b> Spot
            </span>
            <span>
              <b>{atm.toLocaleString('en-IN')}</b> ATM
            </span>
            <span>
              <b>1.08</b> PCR
            </span>
          </div>
          <div className={`chain-table view-${chainView.toLowerCase()}`}>
            <div className="chain-row chain-labels">
              <span>CALL LTP</span>
              <span>STRIKE</span>
              <span>PUT LTP</span>
              <span>OI PROFILE</span>
            </div>
            <div className="chain-scroll">
              {chainRows.map((row, i) => {
                const strike = row.strike;
                const d = (strike - atm) / meta.step;
                const ce = row.ce?.ltp ?? Math.max(7.5, 122 - d * 29 + i * 1.4);
                const pe = row.pe?.ltp ?? Math.max(7.5, 122 + d * 29 - i * 0.7);
                const ceChange = row.ce?.previousClose
                  ? ((ce - row.ce.previousClose) / row.ce.previousClose) * 100
                  : 0;
                const peChange = row.pe?.previousClose
                  ? ((pe - row.pe.previousClose) / row.pe.previousClose) * 100
                  : 0;
                const oi = oiSeries[i];
                const ceOiChange = oi.ce - oi.cePrevious;
                const peOiChange = oi.pe - oi.pePrevious;
                const isAtm = strike === atm;
                return (
                  <div
                    className={`chain-row ${isAtm ? 'atm' : ''}`}
                    key={strike}
                  >
                    <button
                      className={
                        selectedStrike === strike && side === 'CE'
                          ? 'selected'
                          : ''
                      }
                      onClick={() => {
                        setSelectedStrike(strike);
                        setSide('CE');
                        setLevelPopoverStrike(null);
                      }}
                    >
                      {formatPrice(ce)}
                      <small
                        className={ceChange >= 0 ? 'positive' : 'negative'}
                      >
                        {ceChange >= 0 ? '+' : ''}
                        {ceChange.toFixed(1)}%
                      </small>
                    </button>
                    <button
                      className="strike"
                      data-strike-popover
                      onClick={() => {
                        setSelectedStrike(strike);
                        setLevelPopoverStrike((current) => current === strike ? null : strike);
                      }}
                    >
                      {strike.toLocaleString('en-IN')}
                      {isAtm && <small>ATM</small>}
                      {levelPopoverStrike === strike && (
                        <span className="strike-popover" onPointerDown={(event) => event.stopPropagation()}>
                          <span className="strike-popover-title">{meta.short} {strike.toLocaleString('en-IN')} {side}</span>
                          {!optionContractReady ? (
                            <span className="strike-popover-loading">Updating contract…</span>
                          ) : (
                            <>
                              <span className="strike-level resistance"><small>Immediate resistance</small><b>{immediateResistance ? `${immediateResistance.label} · ${formatPrice(immediateResistance.value)}` : '—'}</b></span>
                              <span className="strike-level current"><small>Current option price</small><b>{formatPrice(optionLast)}</b></span>
                              <span className="strike-level support"><small>Immediate support</small><b>{immediateSupport ? `${immediateSupport.label} · ${formatPrice(immediateSupport.value)}` : '—'}</b></span>
                            </>
                          )}
                        </span>
                      )}
                    </button>
                    <button
                      className={
                        selectedStrike === strike && side === 'PE'
                          ? 'selected'
                          : ''
                      }
                      onClick={() => {
                        setSelectedStrike(strike);
                        setSide('PE');
                        setLevelPopoverStrike(null);
                      }}
                    >
                      {formatPrice(pe)}
                      <small
                        className={peChange >= 0 ? 'positive' : 'negative'}
                      >
                        {peChange >= 0 ? '+' : ''}
                        {peChange.toFixed(1)}%
                      </small>
                    </button>
                    <button
                      type="button"
                      className="oi-profile"
                      aria-label={`Open interest details for ${strike.toLocaleString('en-IN')}`}
                    >
                      <span
                        className="oi-bar call"
                        style={{ width: `${Math.max(5, (oi.ce / maxVisibleOi) * 100)}%` }}
                      />
                      <span
                        className="oi-bar put"
                        style={{ width: `${Math.max(5, (oi.pe / maxVisibleOi) * 100)}%` }}
                      />
                      <span className="oi-tooltip" role="tooltip">
                        <span>Expiry: <b>{expiry || '—'}</b></span>
                        <span>Strike: <b>{strike.toLocaleString('en-IN')}</b></span>
                        <span>CE OI: <b className="call-text">{formatOi(oi.ce)}</b></span>
                        <span>CE OI Chg: <b className="call-text">{formatOi(ceOiChange)}</b></span>
                        <span>PE OI: <b className="put-text">{formatOi(oi.pe)}</b></span>
                        <span>PE OI Chg: <b className="put-text">{formatOi(peOiChange)}</b></span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="chain-foot">
            <div>
              <span>Max pain</span>
              <b>{atm.toLocaleString('en-IN')}</b>
            </div>
            <div>
              <span>ATM IV</span>
              <b>12.84%</b>
            </div>
            <div>
              <span>Updated</span>
              <b>
                {live
                  ? new Date(live.updatedAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Demo'}
              </b>
            </div>
          </div>
        </aside>
      </div> : (
        <PositionsView
          mode={paperMode}
          onModeChange={setPaperMode}
          positions={paperPositions}
          engineStatus={paperEngineStatus}
        />
      )}
      <footer className="statusbar">
        <div>
          <span className="status-dot" /> {appView === 'MARKET' ? 'Live workspace' : 'Paper testing workspace'}
        </div>
        <div>
          {appView === 'MARKET' ? <>
            <Crosshair /> Crosshair <span className="divider" />
            <Layers3 /> Formula levels <span className="divider" />
            <BarChart3 /> {timeframe}
          </> : <>
            <BriefcaseBusiness /> ₹1,00,000 demo capital <span className="divider" />
            Strategy pending
          </>}
        </div>
      </footer>
    </main>
  );
}
