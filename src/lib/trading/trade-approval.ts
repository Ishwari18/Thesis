export type ThesisTradeApproval = {
  account: string;
  thesisSlug: string;
  collateral: string;
  leverage: number;
  side: "long" | "short";
  idempotencyKey: string;
  timestamp: number;
  legs: Array<{ symbol: string; side: "bid" | "ask"; amount: string; slippage_percent: "1"; reduce_only: false }>;
};

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortDeep(item)]));
  return value;
}

export function thesisTradeApprovalMessage(approval: ThesisTradeApproval) {
  return `THESIS TRADE APPROVAL\n${JSON.stringify(sortDeep(approval))}`;
}
