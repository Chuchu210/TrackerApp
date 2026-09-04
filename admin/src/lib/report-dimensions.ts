export type ReportDimensionId =
  | 'offers'
  | 'landers'
  | 'paths'
  | 'affiliate_networks'
  | 'conversions'
  | 'country'
  | 'ip'
  | 'devices'
  | 'os'
  | 'browsers'
  | 'referrer'
  | 'language'
  | 'connection'
  | 'click_id'
  | 'transaction_id'
  | 'external_id'
  | 'postback_param_1'
  | 'postback_param_2'
  | 'postback_param_3'
  | 'postback_param_4'
  | 'postback_param_5'
  | 'var_1'
  | 'var_2'
  | 'var_3'
  | 'var_4'
  | 'var_5'
  | 'var_6'
  | 'var_7'
  | 'var_8'
  | 'var_9'
  | 'var_10';

export type ReportDimensionDef = {
  id: ReportDimensionId;
  label: string;
  nameColumnLabel: string;
  tab?: boolean;
};

export const REPORT_DIMENSIONS: ReportDimensionDef[] = [
  { id: 'offers', label: 'Offers', nameColumnLabel: 'Offer name', tab: true },
  { id: 'landers', label: 'Landers', nameColumnLabel: 'Lander name', tab: true },
  { id: 'paths', label: 'Paths', nameColumnLabel: 'Path', tab: true },
  {
    id: 'affiliate_networks',
    label: 'Affiliate networks',
    nameColumnLabel: 'Affiliate network',
    tab: true,
  },
  {
    id: 'conversions',
    label: 'Conversions',
    nameColumnLabel: 'Event type',
    tab: true,
  },
  { id: 'country', label: 'Country', nameColumnLabel: 'Country', tab: true },
  { id: 'ip', label: 'IP', nameColumnLabel: 'IP', tab: true },
  { id: 'devices', label: 'Devices', nameColumnLabel: 'Device', tab: true },
  { id: 'os', label: 'OS', nameColumnLabel: 'OS', tab: true },
  { id: 'browsers', label: 'Browsers', nameColumnLabel: 'Browser', tab: true },
  { id: 'referrer', label: 'Referrer', nameColumnLabel: 'Referrer', tab: true },
  { id: 'language', label: 'Language', nameColumnLabel: 'Language', tab: true },
  { id: 'connection', label: 'Connection', nameColumnLabel: 'Connection', tab: true },
  { id: 'click_id', label: 'Click ID', nameColumnLabel: 'Click ID' },
  { id: 'transaction_id', label: 'Transaction ID', nameColumnLabel: 'Transaction ID' },
  { id: 'external_id', label: 'External ID', nameColumnLabel: 'External ID' },
  { id: 'postback_param_1', label: 'Postback Param 1', nameColumnLabel: 'Postback Param 1' },
  { id: 'postback_param_2', label: 'Postback Param 2', nameColumnLabel: 'Postback Param 2' },
  { id: 'postback_param_3', label: 'Postback Param 3', nameColumnLabel: 'Postback Param 3' },
  { id: 'postback_param_4', label: 'Postback Param 4', nameColumnLabel: 'Postback Param 4' },
  { id: 'postback_param_5', label: 'Postback Param 5', nameColumnLabel: 'Postback Param 5' },
  { id: 'var_1', label: 'V1: Variable 1', nameColumnLabel: 'Variable 1' },
  { id: 'var_2', label: 'V2: Variable 2', nameColumnLabel: 'Variable 2' },
  { id: 'var_3', label: 'V3: Variable 3', nameColumnLabel: 'Variable 3' },
  { id: 'var_4', label: 'V4: Variable 4', nameColumnLabel: 'Variable 4' },
  { id: 'var_5', label: 'V5: Variable 5', nameColumnLabel: 'Variable 5' },
  { id: 'var_6', label: 'V6: Variable 6', nameColumnLabel: 'Variable 6' },
  { id: 'var_7', label: 'V7: Variable 7', nameColumnLabel: 'Variable 7' },
  { id: 'var_8', label: 'V8: Variable 8', nameColumnLabel: 'Variable 8' },
  { id: 'var_9', label: 'V9: Variable 9', nameColumnLabel: 'Variable 9' },
  { id: 'var_10', label: 'V10: Variable 10', nameColumnLabel: 'Variable 10' },
];

export const REPORT_TAB_DIMENSIONS = REPORT_DIMENSIONS.filter((d) => d.tab);
export const REPORT_MENU_DIMENSIONS = REPORT_DIMENSIONS.filter((d) => !d.tab);

export function getReportDimension(id: string): ReportDimensionDef | undefined {
  return REPORT_DIMENSIONS.find((d) => d.id === id);
}

export type ReportLevel = 'campaigns' | ReportDimensionId;

export function isDrilldownLevel(level: ReportLevel): level is ReportDimensionId {
  return level !== 'campaigns';
}
