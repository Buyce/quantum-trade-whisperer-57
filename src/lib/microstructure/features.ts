import type { TradeFlowFeatures, TradePrint, VolumeProfile, VolumeProfileLevel } from "./types";

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;
const round = (value: number, dp = 8) => Number(value.toFixed(dp));

function bucketPrice(price: number, tickSize: number): number {
  return round(Math.round(price / tickSize) * tickSize);
}

export function buildVolumeProfile(
  trades: readonly TradePrint[],
  tickSize: number,
  valueAreaFraction = 0.7,
): VolumeProfile {
  if (!finitePositive(tickSize)) throw new Error("tickSize must be positive");
  if (!(valueAreaFraction > 0 && valueAreaFraction <= 1)) {
    throw new Error("valueAreaFraction must be in (0, 1]");
  }

  const buckets = new Map<number, VolumeProfileLevel>();
  for (const trade of trades) {
    if (!finitePositive(trade.price) || !finitePositive(trade.size)) continue;
    const price = bucketPrice(trade.price, tickSize);
    const current = buckets.get(price) ?? {
      price,
      volume: 0,
      buyVolume: 0,
      sellVolume: 0,
      delta: 0,
    };
    current.volume += trade.size;
    if (trade.aggressorSide === "buy") current.buyVolume += trade.size;
    if (trade.aggressorSide === "sell") current.sellVolume += trade.size;
    current.delta = current.buyVolume - current.sellVolume;
    buckets.set(price, current);
  }

  const levels = [...buckets.values()]
    .map((level) => ({
      ...level,
      volume: round(level.volume),
      buyVolume: round(level.buyVolume),
      sellVolume: round(level.sellVolume),
      delta: round(level.delta),
    }))
    .sort((a, b) => a.price - b.price);

  const totalVolume = round(levels.reduce((sum, level) => sum + level.volume, 0));
  if (!levels.length || totalVolume <= 0) {
    return {
      tickSize,
      poc: null,
      valueAreaLow: null,
      valueAreaHigh: null,
      totalVolume: 0,
      levels: [],
    };
  }

  const ranked = [...levels].sort(
    (a, b) => b.volume - a.volume || Math.abs(a.price) - Math.abs(b.price),
  );
  const poc = ranked[0]!.price;
  const target = totalVolume * valueAreaFraction;
  let covered = 0;
  const included: number[] = [];
  for (const level of ranked) {
    included.push(level.price);
    covered += level.volume;
    if (covered >= target) break;
  }

  return {
    tickSize,
    poc,
    valueAreaLow: Math.min(...included),
    valueAreaHigh: Math.max(...included),
    totalVolume,
    levels,
  };
}

export function computeTradeFlowFeatures(
  trades: readonly TradePrint[],
  tickSize: number,
): TradeFlowFeatures {
  const valid = trades
    .filter((trade) => finitePositive(trade.price) && finitePositive(trade.size))
    .sort(
      (a, b) =>
        Date.parse(a.eventTime) - Date.parse(b.eventTime) || (a.sequence ?? 0) - (b.sequence ?? 0),
    );

  let buyVolume = 0;
  let sellVolume = 0;
  let unknownVolume = 0;
  for (const trade of valid) {
    if (trade.aggressorSide === "buy") buyVolume += trade.size;
    else if (trade.aggressorSide === "sell") sellVolume += trade.size;
    else unknownVolume += trade.size;
  }

  const totalVolume = buyVolume + sellVolume + unknownVolume;
  const classifiedVolume = buyVolume + sellVolume;
  const delta = buyVolume - sellVolume;
  const firstPrice = valid[0]?.price ?? null;
  const lastPrice = valid[valid.length - 1]?.price ?? null;

  return {
    tradeCount: valid.length,
    totalVolume: round(totalVolume),
    buyVolume: round(buyVolume),
    sellVolume: round(sellVolume),
    unknownVolume: round(unknownVolume),
    delta: round(delta),
    deltaRatio: classifiedVolume > 0 ? round(delta / classifiedVolume) : null,
    firstPrice,
    lastPrice,
    priceChange: firstPrice !== null && lastPrice !== null ? round(lastPrice - firstPrice) : null,
    volumeProfile: buildVolumeProfile(valid, tickSize),
  };
}
