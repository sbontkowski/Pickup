export interface Business {
  id: string;
  name: string;
  owner_name: string | null;
  owner_cell: string | null;
  forward_number: string | null;
  timezone: string;
  facts: Record<string, unknown>;
  deposit_cents: number;
  deposit_label: string | null;
  stripe_customer_id: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_status: "not_started" | "pending" | "active";
  plan: "catch" | "answer";
  status: "trial" | "active" | "paused";
}

export interface Lead {
  id: string;
  business_id: string;
  phone: string;
  name: string | null;
  address: string | null;
  zip: string | null;
  job_type: string | null;
  urgency: "emergency" | "soon" | "flexible" | null;
  summary: string | null;
  score: number | null;
  status: "new" | "qualifying" | "booked" | "confirmed" | "escalated" | "lost";
  est_value_cents: number | null;
}
