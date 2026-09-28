import Link from "next/link";
import { admin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/tenancy";
import { teamRowsFor } from "@/server/team";

/** "Team" link + notification bell in the top bar — only for agency team members (never clients). */
export async function TeamLinks() {
  const user = await currentUser().catch(() => null);
  if (!user) return null;
  const rows = await teamRowsFor(user.id).catch(() => []);
  if (!rows.length) return null;
  const { count } = await admin().from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null);
  const n = count ?? 0;
  return (
    <span className="flex items-center gap-3">
      <Link href="/team" className="font-medium text-ink hover:underline">
        Team
      </Link>
      <Link href="/team/notifications" className="relative text-muted hover:text-ink" aria-label={`Notifications${n ? `: ${n} unread` : ""}`}>
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {n > 0 && <span className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-white">{n > 99 ? "99+" : n}</span>}
      </Link>
    </span>
  );
}
