export function safeAuthRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return "/discover";
  try {
    const parsed = new URL(value, "https://thesis.invalid");
    if (parsed.origin !== "https://thesis.invalid") return "/discover";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return "/discover"; }
}
