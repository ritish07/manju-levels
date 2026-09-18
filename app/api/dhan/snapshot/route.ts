import { tradingDayCandles, tradingDate } from '@/app/lib/option-levels';
import { dhan } from '@/app/lib/dhan-api';
import { dhanHeaders } from '@/app/lib/dhan-auth';
import { NextRequest, NextResponse } from 'next/server';

const DHAN_API = 'https://api.dhan.co/v2';
const DHAN_MASTER = 'https://images.dhan.co/api-data/api-scrip-master.csv';
let futuresCache: { expires: number; rows: string[][]; index: Record<string, number> } | null = null;
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



function parseCsvLine(line: string) {
  const fields: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(value);
      value = '';
    } else value += char;
  }
  fields.push(value);
  return fields;
}

async function nearestFuture(asset: Asset) {
  if (!futuresCache || futuresCache.expires < Date.now()) {
    const response = await fetch(DHAN_MASTER, {
      cf: { cacheTtl: 21600 },
    } as RequestInit);
    if (!response.ok) throw new Error(`Instrument list HTTP ${response.status}`);
    const lines = (await response.text()).split(/\r?\n/);
    const headers = parseCsvLine(lines[0]);
    futuresCache = {
      expires: Date.now() + 21600000,
      rows: lines.slice(1).map(parseCsvLine),
      index: Object.fromEntries(headers.map((name, i) => [name, i])),
    };
  }
  const { rows, index } = futuresCache;
  const exchange = asset === 'SENSEX' ? 'BSE' : 'NSE';
  const now = Date.now();
  const candidates = rows
    .filter((row) => {
      const symbol = row[index.SEM_TRADING_SYMBOL] || '';
      const expiry = Date.parse(row[index.SEM_EXPIRY_DATE] || '');
      return row[index.SEM_EXM_EXCH_ID] === exchange &&
        row[index.SEM_SEGMENT] === 'D' &&
        row[index.SEM_INSTRUMENT_NAME] === 'FUTIDX' &&
        symbol.startsWith(`${asset}-`) && expiry >= now;
    })
    .sort((a, b) => Date.parse(a[index.SEM_EXPIRY_DATE]) - Date.parse(b[index.SEM_EXPIRY_DATE]));
  const row = candidates[0];
  if (!row) return null;
  return {
    securityId: Number(row[index.SEM_SMST_SECURITY_ID]),
    symbol: row[index.SEM_CUSTOM_SYMBOL] || row[index.SEM_TRADING_SYMBOL],
    expiry: row[index.SEM_EXPIRY_DATE],
    segment: asset === 'SENSEX' ? 'BSE_FNO' : 'NSE_FNO',
  };
}

async function indexFutureQuote(asset: Asset) {
  try {
    const future = await nearestFuture(asset);
    if (!future) return null;
    const response = await dhan('/marketfeed/ltp', {
      [future.segment]: [future.securityId],
    });
    return {
      symbol: future.symbol,
      expiry: future.expiry,
      price: Number(response.data?.[future.segment]?.[String(future.securityId)]?.last_price || 0),
    };
  } catch {
    return null;
  }
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
  limit = true,
  currentDay = false,
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
    fromDate: `${istDate(currentDay ? now : from)} 09:15:00`,
    toDate: `${istDate(now)} 23:59:59`,
  });
  const candles = aggregate(normalize(raw, timeframe), factor, timeframe);
  return limit ? candles.slice(-180) : candles;
}

// The first session open is immutable. Always derive it from Dhan's raw
// one-minute candles for the latest session that actually traded.
const optionOpens = new Map<string, number>();
async function optionDayOpen(spec: { securityId: number; segment: string; instrument: string }) {
  const key = `${tradingDate()}:${spec.segment}:${spec.securityId}`;
  if (optionOpens.has(key)) return optionOpens.get(key)!;
  let candles = await history(spec, '1m', false, true);
  // On weekends, exchange holidays, or before the first candle arrives, fall
  // back to recent history and use Dhan's latest completed trading session.
  if (!candles.length) candles = await history(spec, '1m', false, false);
  const latest = candles.at(-1);
  const sessionDate = latest ? tradingDate(latest.timestamp) : '';
  const open = sessionDate ? tradingDayCandles(candles, sessionDate)[0]?.open || 0 : 0;
  if (open > 0) optionOpens.set(key, open);
  if (optionOpens.size > 300) for (const cachedKey of optionOpens.keys()) {
    if (!cachedKey.startsWith(`${tradingDate()}:`)) optionOpens.delete(cachedKey);
  }
  return open;
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

function findDayOpen(candles: Candle[], fallback: number) {
  const latest = candles.at(-1);
  if (!latest) return fallback;
  const latestDate = istDate(new Date(latest.timestamp * 1000));
  return (
    candles.find(
      (candle) =>
        istDate(new Date(candle.timestamp * 1000)) === latestDate,
    )?.open || fallback
  );
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const asset = (params.get('asset') || 'NIFTY') as Asset;
    const underlyingTimeframe = params.get('underlyingTimeframe') || params.get('timeframe') || '5m';
    const optionTimeframe = params.get('optionTimeframe') || params.get('timeframe') || '5m';
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
        underlyingTimeframe,
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
          dayOpen: findDayOpen(underlyingCandles, spot),
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
    const optionSecurityId = Number(params.get('optionSecurityId') || 0);
    if (params.get('optionsOnly') === '1') {
      if (!Number.isSafeInteger(optionSecurityId) || optionSecurityId <= 0 || wantedStrike <= 0)
        return NextResponse.json({ error: 'Invalid option contract' }, { status: 400 });
      const optionSpec = { securityId: optionSecurityId,
        segment: asset === 'SENSEX' ? 'BSE_FNO' : 'NSE_FNO', instrument: 'OPTIDX' };
      const [optionCandles, open] = await Promise.all([
        history(optionSpec, optionTimeframe), optionDayOpen(optionSpec),
      ]);
      return NextResponse.json({ connected: true, optionsOnly: true, asset,
        selectedStrike: wantedStrike, side: side.toUpperCase(), optionCandles,
        optionDayOpen: open, optionTimeframe, updatedAt: new Date().toISOString() },
        { headers: { 'Cache-Control': 'no-store' } });
    }
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
              previousOi: Number(legs.ce.previous_oi || 0),
              previousClose: Number(legs.ce.previous_close_price || 0),
              securityId: Number(legs.ce.security_id),
            }
          : null,
        pe: legs.pe
          ? {
              ltp: Number(legs.pe.last_price || 0),
              oi: Number(legs.pe.oi || 0),
              previousOi: Number(legs.pe.previous_oi || 0),
              previousClose: Number(legs.pe.previous_close_price || 0),
              securityId: Number(legs.pe.security_id),
            }
          : null,
      }))
      .sort((a, b) => a.strike - b.strike);
    const spot = Number(chainResponse.data?.last_price || 0);
    const targetStrike = wantedStrike || spot;
    const selected = chain.reduce(
      (best, row) =>
        Math.abs(row.strike - targetStrike) <
        Math.abs(best.strike - targetStrike)
          ? row
          : best,
      chain[0],
    );
    const contract = selected?.[side];
    const [underlyingCandles, optionCandles, open, future] = await Promise.all([
      history(spec, underlyingTimeframe),
      contract
        ? history(
            {
              securityId: contract.securityId,
              segment: asset === 'SENSEX' ? 'BSE_FNO' : 'NSE_FNO',
              instrument: 'OPTIDX',
            },
            optionTimeframe,
          )
        : Promise.resolve([]),
      contract
        ? optionDayOpen({ securityId: contract.securityId,
            segment: asset === 'SENSEX' ? 'BSE_FNO' : 'NSE_FNO', instrument: 'OPTIDX' })
        : Promise.resolve(0),
      indexFutureQuote(asset),
    ]);
    const weeklyOpen = findWeeklyOpen(underlyingCandles, spot);
    const dayOpen = findDayOpen(underlyingCandles, spot);
    return NextResponse.json(
      {
        connected: true,
        asset,
        spot,
        expiry,
        expiries,
        weeklyOpen,
        dayOpen,
        futurePrice: future?.price || 0,
        futureSymbol: future?.symbol || '',
        futureExpiry: future?.expiry || '',
        chain,
        selectedStrike: selected?.strike,
        side: side.toUpperCase(),
        underlyingCandles,
        optionCandles,
        optionDayOpen: open,
        underlyingTimeframe,
        optionTimeframe,
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
