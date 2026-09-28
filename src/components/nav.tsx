"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export type NavItem = { href: string; label: string; group?: string };

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Workspace" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {items.map((it, i) => {
        const active = it.href === path || (it.href.split("/").length > 3 && path.startsWith(it.href));
        const header = it.group && (i === 0 || items[i - 1].group !== it.group) ? it.group : null;
        return (
          <div key={it.href} className="contents md:block">
            {header && <div className="hidden px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted md:block">{header}</div>}
            <Link
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={clsx("block whitespace-nowrap rounded-md px-2 py-1.5 text-sm", active ? "bg-brand text-white" : "text-ink hover:bg-gray-100")}
            >
              {it.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
