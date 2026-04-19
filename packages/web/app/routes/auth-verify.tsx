import { redirect, useLoaderData } from "react-router";
import { api } from "../lib/api";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const token = url.searchParams.get("token");

  if (!userId || !token) {
    return { error: "Invalid magic link" };
  }

  const result = await api.verify({ userId, challenge: token });
  if (!result.ok) {
    return { error: result.error.message };
  }

  // Forward the session cookie to the browser
  const setCookie = result.headers.get("set-cookie");
  throw redirect("/app", {
    headers: setCookie ? { "Set-Cookie": setCookie } : {},
  });
}

export default function AuthVerify() {
  const data = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        {data?.error ? (
          <>
            <h1 className="text-2xl font-bold text-warn">Link expired</h1>
            <p className="mt-2 text-ink-faint">{data.error}</p>
            <a
              href="/login"
              className="mt-6 inline-block rounded-sm bg-amber-soft border border-amber px-6 py-3 font-semibold text-ink hover:bg-amber-soft"
            >
              Request a new link
            </a>
          </>
        ) : (
          <p className="text-ink-faint">Signing you in...</p>
        )}
      </div>
    </div>
  );
}
