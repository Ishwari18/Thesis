export type TradingReadinessInput = {
  authenticated: boolean;
  phantomConnected: boolean;
  walletOwnershipVerified: boolean;
  testnetVerified: boolean;
  accountAddressMatches: boolean;
  availableCollateral: number | null;
  requestedCollateral: number;
  freshMarketData: boolean;
  allocationValid: boolean;
  leverageAllowed: boolean;
  submitting: boolean;
};

export function canSubmitTrade(input: TradingReadinessInput): boolean {
  return input.authenticated && input.phantomConnected && input.walletOwnershipVerified && input.testnetVerified &&
    input.accountAddressMatches && input.availableCollateral !== null && Number.isFinite(input.availableCollateral) &&
    input.requestedCollateral > 0 && input.availableCollateral >= input.requestedCollateral && input.freshMarketData &&
    input.allocationValid && input.leverageAllowed && !input.submitting;
}
