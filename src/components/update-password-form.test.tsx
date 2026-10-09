/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UpdatePasswordForm } from "./update-password-form";

type RecoverySession = { user: { email: string } } | null;
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as ((event: string, session: RecoverySession) => void) | null,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: mocks }) }));

function fillPasswords(password: string, confirmation: string) {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: confirmation } });
}
function submitForm() {
  const form = screen.getByLabelText("New password").closest("form");
  if (!form) throw new Error("Password form not found");
  fireEvent.submit(form);
}

describe("UpdatePasswordForm", () => {
  beforeEach(() => {
    cleanup();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
    mocks.getSession.mockReset();
    mocks.updateUser.mockReset();
    mocks.onAuthStateChange.mockReset();
    mocks.unsubscribe.mockReset();
    mocks.listener = null;
    mocks.getSession.mockResolvedValue({ data: { session: { user: { email: "trader@example.com" } } }, error: null });
    mocks.onAuthStateChange.mockImplementation((listener: (event: string, session: RecoverySession) => void) => {
      mocks.listener = listener;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  it("updates the password only when confirmation matches", async () => {
    mocks.updateUser.mockResolvedValue({ data: { user: { email: "trader@example.com" } }, error: null });
    render(<UpdatePasswordForm />);
    await screen.findByLabelText("New password");
    fillPasswords("new-password-42", "new-password-42");
    submitForm();
    expect(await screen.findByText(/password has been updated/i)).toBeTruthy();
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "new-password-42" });
    expect(screen.getByRole("link", { name: "Continue to THESIS" })).toBeTruthy();
  });

  it("rejects mismatched passwords before calling Supabase", async () => {
    render(<UpdatePasswordForm />);
    await screen.findByLabelText("New password");
    fillPasswords("new-password-42", "different-password-42");
    submitForm();
    expect(await screen.findByText(/passwords do not match/i)).toBeTruthy();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("requires a valid recovery session", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<UpdatePasswordForm />);
    expect(await screen.findByText(/reset link is invalid or expired/i)).toBeTruthy();
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("clears loading state after update failures", async () => {
    mocks.updateUser.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<UpdatePasswordForm />);
    await screen.findByLabelText("New password");
    fillPasswords("new-password-42", "new-password-42");
    submitForm();
    expect(await screen.findByText(/could not reach supabase/i)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Update password" }).hasAttribute("disabled")).toBe(false));
  });
});
