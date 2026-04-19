import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  index("routes/landing.tsx"),
  route("colophon", "routes/colophon.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("auth/verify", "routes/auth-verify.tsx"),
  route("logout", "routes/logout.tsx"),

  layout("routes/app/layout.tsx", [
    ...prefix("app", [
      index("routes/app/home.tsx"),
      ...prefix("fridays", [
        index("routes/app/fridays/index.tsx"),
        route(":fridayId", "routes/app/fridays/detail.tsx"),
      ]),
      ...prefix("cubes", [
        index("routes/app/cubes/index.tsx"),
        route("new", "routes/app/cubes/new.tsx"),
        route(":cubeId", "routes/app/cubes/detail.tsx"),
      ]),
      ...prefix("pods", [
        route(":podId", "routes/app/pods/detail.tsx"),
        route(":podId/round/:roundNumber", "routes/app/pods/round.tsx"),
      ]),
      route("profile", "routes/app/profile.tsx"),
      route("test", "routes/app/test-panel.tsx"),
    ]),
  ]),

  layout("routes/admin/layout.tsx", [
    ...prefix("admin", [
      index("routes/admin/dashboard.tsx"),
      route("audit", "routes/admin/audit.tsx"),
      route("fridays/:fridayId", "routes/admin/friday-override.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
