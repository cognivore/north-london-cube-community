import { Form, Link, useActionData, redirect } from "react-router";
import { api, cookieHeader } from "../lib/api";
import { usePow, PowFields } from "../lib/use-pow";

export async function loader({ request }: { request: Request }) {
  const result = await api.me({ headers: cookieHeader(request) });
  if (result.ok) return redirect("/app");
  return null;
}

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const powId = formData.get("powId") as string | null;
  const powNonce = formData.get("powNonce") as string | null;
  const pow = powId && powNonce ? { id: powId, nonce: powNonce } : undefined;

  const result = await api.login({ email, pow });
  if (!result.ok) {
    return { error: result.error.message };
  }

  return { emailSent: true, email };
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  // Solve a fresh proof-of-work challenge on load and after each submit
  // (each challenge is single-use on the server).
  const pow = usePow(actionData);

  if (actionData?.emailSent) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold text-ink">Check your email</h1>
          <p className="mt-3 text-ink-faint">
            We sent a sign-in link to{" "}
            <span className="font-medium text-amber">{actionData.email}</span>
          </p>
          <p className="mt-2 text-sm text-ink-faint">
            Click the link in the email to sign in. It expires in 30 minutes.
          </p>
          <p className="mt-3 text-sm text-amber">
            Our emails may land in spam — please check your junk folder
            and mark us as "not spam" if so!
          </p>
          <Form method="post" className="mt-6">
            <input type="hidden" name="email" value={actionData.email} />
            <PowFields solution={pow.solution} />
            <button
              type="submit"
              disabled={pow.solving || !pow.solution}
              className="text-sm text-dci-teal underline hover:text-dci-teal disabled:opacity-50"
            >
              {pow.solving ? "Checking…" : "Resend link"}
            </button>
          </Form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-ink-faint">
          We'll email you a magic link
        </p>

        {actionData?.error && (
          <div className="mt-4 rounded-sm bg-warn-soft p-3 text-sm text-warn">
            {actionData.error}
          </div>
        )}

        {pow.vpnHint && (
          <div className="mt-4 rounded-sm bg-amber-soft border border-amber p-3 text-sm text-ink">
            You appear to be on a VPN or proxy. Sign-in still works, but turning
            it off will make the anti-spam check instant.
          </div>
        )}
        {pow.error && (
          <div className="mt-4 rounded-sm bg-warn-soft p-3 text-sm text-warn">{pow.error}</div>
        )}

        <Form method="post" className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-ink-soft">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-sm border border-rule-heavy bg-paper px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-dci-teal focus:outline-none focus:ring-1 focus:ring-dci-teal"
              placeholder="you@example.com"
            />
          </div>

          <PowFields solution={pow.solution} />
          <button
            type="submit"
            disabled={pow.solving || !pow.solution}
            className="w-full rounded-sm bg-amber-soft border border-amber py-2.5 font-semibold text-ink hover:bg-amber-soft transition-colors min-h-[44px] disabled:opacity-50"
          >
            {pow.solving ? "Checking you're human…" : "Send magic link"}
          </button>
        </Form>

        <p className="mt-4 text-center text-sm text-ink-faint">
          No account?{" "}
          <Link to="/register" className="text-dci-teal underline hover:text-dci-teal">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
