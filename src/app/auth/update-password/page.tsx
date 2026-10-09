import { UpdatePasswordForm } from "@/components/update-password-form";
export default function UpdatePasswordPage() {
  return <main className="page-shell auth-shell">
    <div className="auth-copy">
      <div className="eyebrow">ACCOUNT ACCESS</div>
      <h1>Choose a new password</h1>
      <p>Use the secure recovery link sent to your email to set a new password for THESIS.</p>
    </div>
    <UpdatePasswordForm />
  </main>;
}
