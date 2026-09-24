import type { ReactNode } from "react";
import "./admin.css";
import { AdminNavLinks } from "./nav";
import { logout } from "../logout/actions";

// Only the authenticated console screens (Clients, Client detail, Queue,
// Money) live under this route group — /admin/login and /admin/verify are
// siblings outside it, so they never get this nav shell (middleware.ts
// already lets them through unauthenticated).
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-body">
      <nav className="admin-nav">
        <span className="admin-nav-title">Pickup admin</span>
        <AdminNavLinks />
        <form action={logout}>
          <button type="submit">Log out</button>
        </form>
      </nav>
      <div className="admin-page">{children}</div>
    </div>
  );
}
