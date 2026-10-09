/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthForm } from "./auth-form";

type MockSession = { user: { email: string } } | null;
const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as ((event: string, session: MockSession) => void) | null,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: mocks }) }));

function fillForm(email = "trader@example.com", password = "correct-horse-42") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  const passwordInput = screen.queryByLabelText("Password");
  if (passwordInput) fireEvent.change(passwordInput, { target: { value: password } });
}
function submitForm() {
  const form = screen.getByLabelText("Email").closest("form");
  if (!form) throw new Error("Auth form not found");
  fireEvent.submit(form);
}

describe("AuthForm", () => {
  beforeEach(() => {
    cleanup();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
    mocks.signInWithPassword.mockReset();
    mocks.signUp.mockReset();
    mocks.resetPasswordForEmail.mockReset();
    mocks.signOut.mockReset();
    mocks.onAuthStateChange.mockReset();
    mocks.unsubscribe.mockReset();
    mocks.listener = null;
    mocks.onAuthStateChange.mockImplementation((listener: (event: string, session: MockSession) => void) => {
      mocks.listener = listener;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  it("signs in, displays the account, and signs out", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { email: "trader@example.com" }, session: { access_token: "fake" } }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    render(<AuthForm />);
    fillForm();
    submitForm();
    await screen.findByText("trader@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { name: "Sign in" });
    expect(await screen.findByText("Signed out.")).toBeTruthy();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("shows a safe invalid-credentials message", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" } });
    render(<AuthForm />);
    fillForm();
    submitForm();
    expect(await screen.findByText(/email or password is incorrect/i)).toBeTruthy();
  });

  it("shows a confirmation-required message without claiming the user is signed in", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: { email: "trader@example.com" }, session: null }, error: null });
    render(<AuthForm />);
    fireEvent.click(screen.getByRole("button", { name: /create an account/i }));
    fillForm();
    submitForm();
    expect(await screen.findByText(/confirm your email/i)).toBeTruthy();
    expect(screen.queryByText("trader@example.com")).toBeNull();
    expect(mocks.signUp.mock.calls[0]?.[0].options.emailRedirectTo).toContain("/auth/callback");
  });

  it("handles signup with an active session", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: { email: "trader@example.com" }, session: { access_token: "fake" } }, error: null });
    render(<AuthForm />);
    fireEvent.click(screen.getByRole("button", { name: /create an account/i }));
    fillForm();
    submitForm();
    expect(await screen.findByText("trader@example.com")).toBeTruthy();
    expect(await screen.findByText("Account created and signed in.")).toBeTruthy();
  });

  it("handles duplicate signup errors distinctly", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: { code: "email_exists", status: 400, message: "User already registered" } });
    render(<AuthForm />);
    fireEvent.click(screen.getByRole("button", { name: /create an account/i }));
    fillForm();
    submitForm();
    expect(await screen.findByText(/account may already exist/i)).toBeTruthy();
  });

  it("requests a recovery email without revealing whether an account exists", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "trader@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    submitForm();
    expect(await screen.findByText(/if an account exists/i)).toBeTruthy();
    expect(screen.queryByText("trader@example.com")).toBeNull();
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledOnce();
    expect(mocks.resetPasswordForEmail.mock.calls[0]?.[1].redirectTo).toContain("/auth/callback?next=");
    expect(mocks.resetPasswordForEmail.mock.calls[0]?.[1].redirectTo).toContain("auth%2Fupdate-password");
  });

  it("restores the form after a network exception", async () => {
    mocks.signInWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AuthForm />);
    fillForm();
    submitForm();
    expect(await screen.findByText(/could not reach supabase/i)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(false));
  });

  it("does not submit twice while a request is pending", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    mocks.signInWithPassword.mockReturnValue(new Promise(resolve => { resolveRequest = resolve; }));
    render(<AuthForm />);
    fillForm();
    submitForm();
    submitForm();
    expect(mocks.signInWithPassword).toHaveBeenCalledOnce();
    resolveRequest?.({ data: { user: { email: "trader@example.com" }, session: { access_token: "fake" } }, error: null });
    expect(await screen.findByText("trader@example.com")).toBeTruthy();
  });

  it("updates account state from auth events and unsubscribes on unmount", async () => {
    const view = render(<AuthForm />);
    expect(mocks.listener).toBeTypeOf("function");
    mocks.listener?.("SIGNED_IN", { user: { email: "event@example.com" } });
    expect(await screen.findByText("event@example.com")).toBeTruthy();
    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("disables auth when public configuration is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    render(<AuthForm />);
    expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/project URL is missing/i)).toBeTruthy();
  });

  it("keeps entered values when switching modes", () => {
    render(<AuthForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create an account/i }));
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("trader@example.com");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("correct-horse-42");
  });

  it("shows development diagnostics without rendering submitted credentials or the public key", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { code: "validation_failed", status: 400, message: "Rejected trader@example.com correct-horse-42 test-publishable-key" } });
    render(<AuthForm />);
    fillForm();
    submitForm();
    await screen.findByText(/check the email address/i);
    const details = screen.getByText(/Rejected/);
    expect(details.textContent).not.toContain("correct-horse-42");
    expect(details.textContent).not.toContain("test-publishable-key");
  });
});
