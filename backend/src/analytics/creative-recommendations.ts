export type CreativeQuality = 'excellent' | 'good' | 'average' | 'poor' | 'risk' | 'low_data';

export type CreativePerformanceRow = {
  key: string;
  label: string;
  visits: number;
  uniqueVisitors: number;
  botVisits: number;
  humanVisits: number;
  botPct: string;
  convertingVisits: number;
  conversions: number;
  cr: string;
  crNum: number;
  revenue: number;
  epc: number;
  spend: number;
  cpv: number;
  costPerEvent: number;
  profit: number;
  quality: CreativeQuality;
  topHeadline?: string;
  topHeadlineCr?: string;
  topImage?: string;
  topImageCr?: string;
  imageUrl?: string;
  cta?: string;
};

export type CreativePairRow = CreativePerformanceRow & {
  imageKey: string;
  imageLabel: string;
  headlineKey: string;
  headlineLabel: string;
};

export type CreativeRecommendation = {
  id: string;
  severity: 'success' | 'warning' | 'danger' | 'info';
  category: 'image' | 'headline' | 'combo' | 'publisher' | 'general';
  title: string;
  message: string;
  action: string;
  entityKey?: string;
  entityLabel?: string;
  metric?: string;
};

export type CreativeBenchmarks = {
  avgCr: number;
  avgBotPct: number;
  avgEpc: number;
  totalVisits: number;
  minSample: number;
  totalEvents: number;
  metricLabel: string;
  totalSpend: number;
  avgCpv: number;
  avgCostPerEvent: number;
};

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function spendLine(row: CreativePerformanceRow): string {
  if (row.spend <= 0) return '';
  const parts = [`${fmtMoney(row.spend)} spend`, `${fmtMoney(row.cpv)} CPV`];
  if (row.conversions > 0) parts.push(`${fmtMoney(row.costPerEvent)}/event`);
  return ` ${parts.join(', ')}.`;
}

export function scoreCreativeQuality(
  visits: number,
  crNum: number,
  botPct: number,
  benchmarks: CreativeBenchmarks,
): CreativeQuality {
  if (visits < benchmarks.minSample) return 'low_data';
  if (botPct >= 40) return 'risk';
  if (crNum >= benchmarks.avgCr * 1.25 && botPct < 25) return 'excellent';
  if (crNum >= benchmarks.avgCr && botPct < 30) return 'good';
  if (crNum < benchmarks.avgCr * 0.5 && visits >= benchmarks.minSample * 2) return 'poor';
  return 'average';
}

export function buildCreativeRecommendations(
  images: CreativePerformanceRow[],
  headlines: CreativePerformanceRow[],
  pairs: CreativePairRow[],
  benchmarks: CreativeBenchmarks,
  countMode: 'recorded' | 'sent' = 'recorded',
): CreativeRecommendation[] {
  const recs: CreativeRecommendation[] = [];
  const min = benchmarks.minSample;
  const rateLabel = benchmarks.metricLabel;

  if (benchmarks.totalEvents === 0 && benchmarks.totalVisits > 0) {
    recs.push({
      id: 'no-events',
      severity: 'info',
      category: 'general',
      title: `No ${rateLabel.replace(' rate', '')} events in this period`,
      message:
        countMode === 'sent'
          ? `No postbacks marked "sent" for this event. Try "Recorded" mode or check Mediago postback config.`
          : `No events recorded in the database. Check LP Funnel page and ensure trackCallClick / registerConversion fire on the LP.`,
      action: 'Verify tracking on the landing page or switch the optimize-for event.',
    });
    return recs;
  }

  const eligibleImages = images.filter((r) => r.visits >= min && r.key !== '(unknown)');
  const eligibleHeadlines = headlines.filter((r) => r.visits >= min && r.key !== '(unknown)');
  const eligiblePairs = pairs.filter((r) => r.visits >= min);

  const bestImage = [...eligibleImages].sort((a, b) => b.crNum - a.crNum || b.visits - a.visits)[0];
  if (bestImage && bestImage.crNum > benchmarks.avgCr) {
    recs.push({
      id: `scale-image-${bestImage.key}`,
      severity: 'success',
      category: 'image',
      title: `Scale image: ${bestImage.label}`,
      message: `${rateLabel} ${bestImage.cr}% vs avg ${benchmarks.avgCr.toFixed(2)}% on ${bestImage.visits} visits (${bestImage.conversions} events). Bot ${bestImage.botPct}%.${spendLine(bestImage)}`,
      action: benchmarks.totalSpend > 0 ? 'Increase budget on this creative — strong rate at efficient spend.' : 'Increase budget on this creative asset.',
      entityKey: bestImage.key,
      entityLabel: bestImage.label,
      metric: bestImage.spend > 0 ? `${bestImage.cr}% · ${fmtMoney(bestImage.cpv)} CPV` : `${bestImage.cr}%`,
    });
  }

  const worstImage = [...eligibleImages]
    .filter((r) => r.visits >= min * 2)
    .sort((a, b) => a.crNum - b.crNum || b.botPct.localeCompare(a.botPct))[0];
  if (worstImage && worstImage.crNum < benchmarks.avgCr * 0.6) {
    recs.push({
      id: `pause-image-${worstImage.key}`,
      severity: 'danger',
      category: 'image',
      title: `Pause or replace image: ${worstImage.label}`,
      message: `${rateLabel} ${worstImage.cr}% with ${worstImage.visits} visits.${spendLine(worstImage)} ${worstImage.botPct}% bot traffic.`,
      action: 'Reduce spend or swap this creative.',
      entityKey: worstImage.key,
      entityLabel: worstImage.label,
      metric: worstImage.spend > 0 ? `${worstImage.cr}% · ${fmtMoney(worstImage.spend)} spend` : `${worstImage.cr}%`,
    });
  }

  if (benchmarks.totalSpend > 0) {
    for (const img of eligibleImages
      .filter((r) => r.spend >= 5 && r.conversions === 0 && r.visits >= min)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 2)) {
      recs.push({
        id: `waste-spend-image-${img.key}`,
        severity: 'warning',
        category: 'image',
        title: `Spend with no events: ${img.label}`,
        message: `${fmtMoney(img.spend)} allocated spend on ${img.visits} visits but 0 ${rateLabel.replace(' rate', '')} events.`,
        action: 'Pause or replace this creative to stop wasted spend.',
        entityKey: img.key,
        entityLabel: img.label,
        metric: fmtMoney(img.spend),
      });
    }
  }

  const bestHeadline = [...eligibleHeadlines].sort((a, b) => b.crNum - a.crNum || b.visits - a.visits)[0];
  if (bestHeadline && bestHeadline.crNum > benchmarks.avgCr) {
    recs.push({
      id: `scale-headline-${bestHeadline.key}`,
      severity: 'success',
      category: 'headline',
      title: `Winning headline: "${bestHeadline.label}"`,
      message: `${rateLabel} ${bestHeadline.cr}% on ${bestHeadline.visits} visits (${bestHeadline.conversions} events).${spendLine(bestHeadline)} Reuse on other images.`,
      action: 'Duplicate headline across top images.',
      entityKey: bestHeadline.key,
      entityLabel: bestHeadline.label,
      metric: bestHeadline.spend > 0 ? `${bestHeadline.cr}% · ${fmtMoney(bestHeadline.cpv)} CPV` : `${bestHeadline.cr}%`,
    });
  }

  const worstHeadline = [...eligibleHeadlines]
    .filter((r) => r.visits >= min * 2)
    .sort((a, b) => a.crNum - b.crNum)[0];
  if (worstHeadline && worstHeadline.crNum < benchmarks.avgCr * 0.6) {
    recs.push({
      id: `pause-headline-${worstHeadline.key}`,
      severity: 'warning',
      category: 'headline',
      title: `Weak headline: "${worstHeadline.label}"`,
      message: `${rateLabel} only ${worstHeadline.cr}% from ${worstHeadline.visits} visits.`,
      action: 'Test a new headline variant.',
      entityKey: worstHeadline.key,
      entityLabel: worstHeadline.label,
      metric: `${worstHeadline.cr}%`,
    });
  }

  const bestPair = [...eligiblePairs].sort((a, b) => b.crNum - a.crNum || b.revenue - a.revenue)[0];
  if (bestPair && bestPair.crNum >= benchmarks.avgCr && bestPair.crNum > 0) {
    recs.push({
      id: `best-combo-${bestPair.key}`,
      severity: 'success',
      category: 'combo',
      title: 'Best image + headline combo',
      message: `"${bestPair.headlineLabel}" on ${bestPair.imageLabel} — ${rateLabel} ${bestPair.cr}% (${bestPair.conversions} events), $${bestPair.revenue.toFixed(2)} revenue.${spendLine(bestPair)}`,
      action: 'Make this your primary ad combination.',
      entityKey: bestPair.key,
      entityLabel: `${bestPair.imageLabel} × ${bestPair.headlineLabel}`,
      metric: bestPair.spend > 0 ? `${bestPair.cr}% · ${fmtMoney(bestPair.costPerEvent)}/event` : `${bestPair.cr}%`,
    });
  }

  for (const img of eligibleImages.filter((r) => parseFloat(r.botPct) >= 35).slice(0, 3)) {
    recs.push({
      id: `bot-image-${img.key}`,
      severity: 'danger',
      category: 'image',
      title: `High bot traffic on image ${img.label}`,
      message: `${img.botPct}% bots on ${img.visits} visits — quality may be inflated.`,
      action: 'Review publisher sources for this creative.',
      entityKey: img.key,
      entityLabel: img.label,
      metric: `${img.botPct}% bots`,
    });
  }

  const lowData = images.filter((r) => r.visits > 0 && r.visits < min).length;
  if (lowData > 0) {
    recs.push({
      id: 'low-sample-images',
      severity: 'info',
      category: 'general',
      title: `${lowData} image(s) need more data`,
      message: `Wait for at least ${min} visits per creative before pausing.`,
      action: 'Let tests run or increase budget slightly.',
    });
  }

  if (recs.length === 0 && benchmarks.totalVisits > 0) {
    recs.push({
      id: 'no-signal',
      severity: 'info',
      category: 'general',
      title: 'Not enough signal yet',
      message: 'Collect more visits with asset_id and ad_title macros in your click URL.',
      action: 'Ensure Mediago passes ${ASSET_ID} and ${AD_TITLE}.',
    });
  }

  return recs.slice(0, 12);
}
