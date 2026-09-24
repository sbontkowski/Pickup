import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { updateFactsAction, updateSettingsAction } from "./actions";
import type { Business, Lead, Message } from "@/lib/types";

export const dynamic = "force-dynamic";

type Supabase = ReturnType<typeof getSupabaseAdmin>;

const TABS = [
  { key: "conversations", label: "Conversations" },
  { key: "bookings", label: "Bookings" },
  { key: "facts", label: "Facts" },
  { key: "phone", label: "Phone" },
  { key: "settings", label: "Settings" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; lead?: string; saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: TabKey = TABS.find((t) => t.key === sp.tab)?.key ?? "conversations";

  const supabase = getSupabaseAdmin();
  const { data: business } = await supabase.from("businesses").select("*").eq("id", id).maybeSingle();
  if (!business) notFound();

  return (
    <div>
      <p className="admin-muted">
        <Link href="/admin">&larr; Clients</Link>
      </p>
      <h1>{business.name}</h1>

      <div className="admin-tabs">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/c/${id}?tab=${t.key}`}
            className={`admin-tab ${tab === t.key ? "admin-tab-active" : ""}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {sp.saved && <p className="admin-muted">Saved.</p>}
      {sp.error && <p className="admin-error">{sp.error}</p>}

      {tab === "conversations" && (
        <ConversationsTab supabase={supabase} businessId={id} selectedLeadId={sp.lead} />
      )}
      {tab === "bookings" && <BookingsTab supabase={supabase} businessId={id} />}
      {tab === "facts" && <FactsTab business={business as Business} />}
      {tab === "phone" && <PhoneTab business={business as Business} />}
      {tab === "settings" && <SettingsTab business={business as Business} />}
    </div>
  );
}

async function ConversationsTab({
  supabase,
  businessId,
  selectedLeadId,
}: {
  supabase: Supabase;
  businessId: string;
  selectedLeadId?: string;
}) {
  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(50);

  let messages: Message[] = [];
  if (selectedLeadId) {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("lead_id", selectedLeadId)
      .order("created_at", { ascending: true });
    messages = (data ?? []) as Message[];
  }

  return (
    <div style={{ display: "flex", gap: "1rem" }}>
      <div className="admin-card" style={{ flex: 1, maxHeight: 500, overflowY: "auto" }}>
        {(leads ?? []).map((lead: Lead) => (
          <div key={lead.id} style={{ padding: "0.4rem 0", borderBottom: "1px solid #e5e7eb" }}>
            <Link href={`/admin/c/${businessId}?tab=conversations&lead=${lead.id}`}>
              {lead.name || lead.phone} — <span className={`admin-chip admin-chip-${lead.status}`}>{lead.status}</span>
            </Link>
          </div>
        ))}
        {(leads ?? []).length === 0 && <p className="admin-muted">No conversations yet.</p>}
      </div>
      <div className="admin-card" style={{ flex: 2 }}>
        {selectedLeadId ? (
          messages.length > 0 ? (
            messages.map((m) => (
              <p key={m.id}>
                <strong>{m.role}:</strong> {m.body}
              </p>
            ))
          ) : (
            <p className="admin-muted">No messages.</p>
          )
        ) : (
          <p className="admin-muted">Select a conversation.</p>
        )}
      </div>
    </div>
  );
}

async function BookingsTab({ supabase, businessId }: { supabase: Supabase; businessId: string }) {
  const { data: appointments } = await supabase
    .from("appointments")
    .select("*, leads(name, phone)")
    .eq("business_id", businessId)
    .order("starts_at", { ascending: false })
    .limit(50);

  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Customer</th>
          <th>Status</th>
          <th>Deposit</th>
        </tr>
      </thead>
      <tbody>
        {(appointments ?? []).map((a) => {
          const lead = a.leads as { name: string | null; phone: string | null } | null;
          return (
            <tr key={a.id}>
              <td>{new Date(a.starts_at).toLocaleString()}</td>
              <td>{lead?.name ?? lead?.phone ?? "—"}</td>
              <td>
                <span className={`admin-chip admin-chip-${a.status}`}>{a.status}</span>
              </td>
              <td>{a.deposit_status}</td>
            </tr>
          );
        })}
        {(appointments ?? []).length === 0 && (
          <tr>
            <td colSpan={4} className="admin-muted">
              No bookings yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function FactsTab({ business }: { business: Business }) {
  return (
    <form action={updateFactsAction.bind(null, business.id)} className="admin-form">
      <label htmlFor="facts">Facts (JSON) — read by the SMS agent, edit carefully</label>
      <textarea id="facts" name="facts" rows={20} defaultValue={JSON.stringify(business.facts, null, 2)} />
      <button type="submit" className="admin-button">
        Save facts
      </button>
    </form>
  );
}

function PhoneTab({ business }: { business: Business }) {
  return (
    <div className="admin-card">
      <p>
        <strong>Forwarding number:</strong> {business.forward_number ?? "not set"}
      </p>
      <p>
        <strong>Stripe Connect status:</strong>{" "}
        <span className={`admin-chip admin-chip-${business.stripe_connect_status}`}>
          {business.stripe_connect_status}
        </span>
      </p>
      <p>
        <strong>Stripe Connect account:</strong> {business.stripe_connect_account_id ?? "none"}
      </p>
      {business.stripe_connect_status !== "active" && business.stripe_connect_account_id && (
        <p>
          <a href={`/api/connect/refresh?business_id=${business.id}`}>Resend onboarding link</a>
        </p>
      )}
    </div>
  );
}

function SettingsTab({ business }: { business: Business }) {
  return (
    <form action={updateSettingsAction.bind(null, business.id)} className="admin-form">
      <label htmlFor="name">Name</label>
      <input id="name" name="name" type="text" defaultValue={business.name} />

      <label htmlFor="owner_name">Owner name</label>
      <input id="owner_name" name="owner_name" type="text" defaultValue={business.owner_name ?? ""} />

      <label htmlFor="owner_cell">Owner cell</label>
      <input id="owner_cell" name="owner_cell" type="text" defaultValue={business.owner_cell ?? ""} />

      <label htmlFor="forward_number">Forwarding number</label>
      <input id="forward_number" name="forward_number" type="text" defaultValue={business.forward_number ?? ""} />

      <label htmlFor="timezone">Timezone</label>
      <input id="timezone" name="timezone" type="text" defaultValue={business.timezone} />

      <label htmlFor="deposit_cents">Deposit (cents)</label>
      <input id="deposit_cents" name="deposit_cents" type="number" defaultValue={business.deposit_cents} />

      <label htmlFor="deposit_label">Deposit label</label>
      <input id="deposit_label" name="deposit_label" type="text" defaultValue={business.deposit_label ?? ""} />

      <label htmlFor="status">Status</label>
      <select id="status" name="status" defaultValue={business.status}>
        <option value="trial">trial</option>
        <option value="active">active</option>
        <option value="paused">paused</option>
      </select>

      <button type="submit" className="admin-button">
        Save settings
      </button>
    </form>
  );
}
