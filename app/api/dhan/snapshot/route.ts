import { NextRequest, NextResponse } from 'next/server';

const DHAN_API = 'https://api.dhan.co/v2';
const ASSETS = {
  NIFTY: { securityId: 13, segment: 'IDX_I', instrument: 'INDEX' },
  BANKNIFTY: { securityId: 25, segment: 'IDX_I', instrument: 'INDEX' },
  SENSEX: { securityId: 51, segment: 'IDX_I', instrument: 'INDEX' },
} as const;

type Asset = keyof typeof ASSETS;
type RawCandles = {
  timestamp?: number[];
  open?: number[];
  high?: number[];
  low?: number[];
  close?: number[];
  volume?: number[];
};
type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: string;
};

function headers() {
  const clientId = process.env.DHAN_CLIENT_ID;
  const token = process.env.DHAN_ACCESS_TOKEN;
  if (!clientId || !token) throw new Error('DHAN_NOT_CONFIGURED');
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'client-id': clientId,
    'access-token': token,
  };
}

async function dhan(path: string, body: object) {
  const response = await fetch(`${DHAN_API}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.status === 'failure')
    throw new Error(
      data?.remarks?.error_message ||
        data?.errorMessage ||
        `Dhan HTTP ${response.status}`,
    );
  return data;
}

function istDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
function timeLabel(timestamp: number, timeframe: string) {
  const date = new Date(timestamp * 1000);
  if (timeframe === 'M')
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      month: 'short',
      year: '2-digit',
    }).format(date);
  if (timeframe === 'D')
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
    }).format(date);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function normalize(raw: RawCandles, timeframe: string): Candle[] {
  return (raw.timestamp || []).map((timestamp, i) => ({
    timestamp,
    open: Number(raw.open?.[i] || 0),
    high: Number(raw.high?.[i] || 0),
    low: Number(raw.low?.[i] || 0),
    close: Number(raw.close?.[i] || 0),
    volume: Number(raw.volume?.[i] || 0),
    time: timeLabel(timestamp, timeframe),
  }));
}

function aggregate(
  candles: Candle[],
  factor: number,
  timeframe: string,
): Candle[] {
  if (factor <= 1)
    return candles.map((c) => ({
      ...c,
      time: timeLabel(c.timestamp, timeframe),
    }));
  const result: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const group = candles.slice(i, i + factor);
    if (!group.length) continue;
    result.push({
      timestamp: group[0].timestamp,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
      time: timeLabel(group[0].timestamp, timeframe),
    });
  }
  return result;
}

async function history(
  spec: { securityId: number; segment: string; instrument: string },
  timeframe: string,
) {
  const now = new Date();
  const from = new Date(
    now.getTime() -
      (timeframe === 'D' || timeframe === 'M' ? 370 : 12) * 86400000,
  );
  if (timeframe === 'D' || timeframe === 'M') {
    const raw = await dhan('/charts/historical', {
      securityId: String(spec.securityId),
      exchangeSegment: spec.segment,
      instrument: spec.instrument,
      expiryCode: 0,
      oi: false,
      fromDate: istDate(from),
      toDate: istDate(now),
    });
    const daily = normalize(raw, 'D');
    if (timeframe === 'D') return daily.slice(-180);
    const months = new Map<string, Candle[]>();
    for (const candle of daily) {
      const key = new Date(candle.timestamp * 1000).toLocaleDateString(
        'en-CA',
        { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' },
      );
      months.set(key, [...(months.get(key) || []), candle]);
    }
    return [...months.values()]
      .map((group) => ({
        timestamp: group[0].timestamp,
        open: group[0].open,
        high: Math.max(...group.map((c) => c.high)),
        low: Math.min(...group.map((c) => c.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((sum, c) => sum + c.volume, 0),
        time: timeLabel(group[0].timestamp, 'M'),
      }))
      .slice(-180);
  }
  const config: Record<string, [string, number]> = {
    '1m': ['1', 1],
    '3m': ['1', 3],
    '5m': ['5', 1],
    '15m': ['15', 1],
    '30m': ['5', 6],
    '1H': ['60', 1],
    '4H': ['60', 4],
  };
  const [interval, factor] = config[timeframe] || config['5m'];
  const raw = await dhan('/charts/intraday', {
    securityId: String(spec.securityId),
    exchangeSegment: spec.segment,
    instrument: spec.instrument,
    interval,
    oi: spec.segment !== 'IDX_I',
    fromDate: `${istDate(from)} 09:00:00`,
    toDate: `${istDate(now)} 23:59:59`,
  });
  return aggregate(normalize(raw, timeframe), factor, timeframe).slice(-180);
}

function findWeeklyOpen(candles: Candle[], fallback: number) {
  const monday = new Date();
  const day = monday.getDay();
  monday.setDate(monday.getDate() - ((day + 6) % 7));
  const mondayText = istDate(monday);
  return (
    candles.find((c) => istDate(new Date(c.timestamp * 1000)) === mondayText)
      ?.open ||
    candles[0]?.open ||
    fallback
  );
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const asset = (params.get('asset') || 'NIFTY') as Asset;
    const timeframe = params.get('timeframe') || '5m';
    const side = params.get('side') === 'PE' ? 'pe' : 'ce';
    const wantedStrike = Number(params.get('strike') || 0);
    const stockSecurityId = Number(params.get('securityId') || 0);
    if (stockSecurityId > 0) {
      const underlyingCandles = await history(
        {
          securityId: stockSecurityId,
          segment: 'NSE_EQ',
          instrument: 'EQUITY',
        },
        timeframe,
      );
      const spot = underlyingCandles.at(-1)?.close || 0;
      return NextResponse.json(
        {
          connected: true,
          asset: 'STOCK',
          symbol: params.get('symbol') || '',
          spot,
          expiry: '',
          expiries: [],
          weeklyOpen: findWeeklyOpen(underlyingCandles, spot),
          chain: [],
          selectedStrike: 0,
          side: '',
          underlyingCandles,
          optionCandles: [],
          updatedAt: new Date().toISOString(),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const spec = ASSETS[asset];
    if (!spec)
      return NextResponse.json(
        { error: 'Unsupported underlying' },
        { status: 400 },
      );
    const expiryResponse = await dhan('/optionchain/expirylist', {
      UnderlyingScrip: spec.securityId,
      UnderlyingSeg: spec.segment,
    });
    const expiries: string[] = expiryResponse.data || [];
    const requestedExpiry = params.get('expiry');
    const expiry =
      requestedExpiry && expiries.includes(requestedExpiry)
        ? requestedExpiry
        : expiries[0];
    if (!expiry) throw new Error('Dhan returned no active option expiry');
    const chainResponse = await dhan('/optionchain', {
      UnderlyingScrip: spec.securityId,
      UnderlyingSeg: spec.segment,
      Expiry: expiry,
    });
    const oc = chainResponse.data?.oc || {};
    const chain = Object.entries(oc)
      .map(([strikeText, legs]: [string, any]) => ({
        strike: Number(strikeText),
        ce: legs.ce
          ? {
              ltp: Number(legs.ce.last_price || 0),
              oi: Number(legs.ce.oi || 0),
              previousClose: Number(legs.ce.previous_close_price || 0),
              securityId: Number(legs.ce.security_id),
            }
          : null,
        pe: legs.pe
          ? {
              ltp: Number(legs.pe.last_price || 0),
              oi: Number(legs.pe.oi || 0),
              previousClose: Number(legs.pe.previous_close_price || 0),
              securityId: Number(legs.pe.security_id),
            }
          : null,
      }))
      .sort((a, b) => a.strike - b.strike);
    const spot = Number(chainResponse.data?.last_price || 0);
    const selected = chain.reduce(
      (best, row) =>
        Math.abs(row.strike - wantedStrike) <
        Math.abs(best.strike - wantedStrike)
          ? row
          : best,
      chain[0],
    );
    const contract = selected?.[side];
    const [underlyingCandles, optionCandles] = await Promise.all([
      history(spec, timeframe),
      contract
        ? history(
            {
              securityId: contract.securityId,
              segment: asset === 'SENSEX' ? 'BSE_FNO' : 'NSE_FNO',
              instrument: 'OPTIDX',
            },
            timeframe,
          )
        : Promise.resolve([]),
    ]);
    const weeklyOpen = findWeeklyOpen(underlyingCandles, spot);
    return NextResponse.json(
      {
        connected: true,
        asset,
        spot,
        expiry,
        expiries,
        weeklyOpen,
        chain,
        selectedStrike: selected?.strike,
        side: side.toUpperCase(),
        underlyingCandles,
        optionCandles,
        updatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Dhan request failed';
    const status = message === 'DHAN_NOT_CONFIGURED' ? 503 : 502;
    return NextResponse.json(
      {
        connected: false,
        error:
          message === 'DHAN_NOT_CONFIGURED'
            ? 'Dhan credentials are not configured'
            : message,
      },
      { status },
    );
  }
}
