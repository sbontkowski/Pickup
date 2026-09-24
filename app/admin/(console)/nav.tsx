"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Clients" },
  { href: "/admin/queue", label: "Attention queue" },
  { href: "/admin/money", label: "Money" },
];

export function AdminNavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((link) => {
        const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} className={active ? "admin-nav-active" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </>
  );
}
