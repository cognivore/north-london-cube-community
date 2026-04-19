import { redirect } from "react-router";

export async function loader() {
  return redirect("/login", {
    headers: {
      "Set-Cookie": "session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    },
  });
}

export default function Logout() {
  return null;
}
