import { Outlet, Link, redirect } from "react-router";
import { api } from "../../lib/api";

export async function loader() {
  const result = await api.me();
  if (!result.ok) throw redirect("/login");
  if (result.data.user.role !== "coordinator") throw redirect("/app");
  return { user: result.data.user };
}

export default function AdminLayout() {
  return (
    <div className="min-h-screen">
      <nav className="border-b border-warn bg-paper">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/admin" className="text-lg font-bold text-warn">
            Admin
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/admin/audit" className="text-ink-soft underline hover:text-ink">
              Audit
            </Link>
            <Link to="/app" className="text-ink-soft underline hover:text-ink">
              Back to app
            </Link>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
