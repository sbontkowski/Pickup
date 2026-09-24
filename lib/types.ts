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
  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  lead_id: string;
  business_id: string;
  starts_at: string;
  ends_at: string;
  status: "held" | "confirmed" | "cancelled" | "completed";
  deposit_status: "none" | "sent" | "paid";
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  appointment_id: string;
  stripe_session_id: string | null;
  amount_cents: number;
  status: string;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Call {
  id: string;
  business_id: string | null;
  caller_phone: string | null;
  twilio_call_sid: string | null;
  caller_type: "human" | "ai_agent" | "unknown";
  missed_at: string | null;
  texted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  lead_id: string;
  role: "customer" | "agent" | "owner" | "system";
  body: string;
  twilio_sid: string | null;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: string;
  business_id: string;
  lead_id: string | null;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
