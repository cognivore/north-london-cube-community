import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  {
    rel: "icon",
    href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎲</text></svg>",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let heading = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    heading = `${error.status} ${error.statusText}`;
    message = error.data?.toString() ?? message;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-red-400">{heading}</h1>
        <p className="mt-2 text-gray-400">{message}</p>
      </div>
    </div>
  );
}
