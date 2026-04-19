import { Form, Link, useActionData } from "react-router";
import { api } from "../lib/api";

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const displayName = formData.get("displayName") as string;
  const inviteCode = formData.get("inviteCode") as string;

  const result = await api.register({ email, displayName, inviteCode });
  if (!result.ok) {
    return { error: result.error.message };
  }

  // Magic link email is sent by the server during registration
  return { emailSent: true, email };
}

export default function Register() {
  const actionData = useActionData<typeof action>();

  if (actionData?.emailSent) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold text-white">Check your email</h1>
          <p className="mt-3 text-gray-400">
            We sent a sign-in link to{" "}
            <span className="font-medium text-amber-400">{actionData.email}</span>
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Click the link in the email to complete registration. It expires in 30 minutes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-white">Register</h1>
        <p className="mt-1 text-sm text-gray-400">
          Join the North London cube community
        </p>

        {actionData?.error && (
          <div className="mt-4 rounded-lg bg-red-900/50 p-3 text-sm text-red-300">
            {actionData.error}
          </div>
        )}

        <Form method="post" className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-300">
              Display name
            </label>
            <input
              id="displayName"
              name="displayName"
              type="text"
              required
              className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="Your name"
            />
          </div>

          <div>
            <label htmlFor="inviteCode" className="block text-sm font-medium text-gray-300">
              Invite code
            </label>
            <input
              id="inviteCode"
              name="inviteCode"
              type="text"
              required
              className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="Enter your invite code"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-amber-500 py-2.5 font-semibold text-gray-950 hover:bg-amber-400 transition-colors min-h-[44px]"
          >
            Create account
          </button>
        </Form>

        <p className="mt-4 text-center text-sm text-gray-400">
          Already have an account?{" "}
          <Link to="/login" className="text-amber-400 hover:text-amber-300">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
