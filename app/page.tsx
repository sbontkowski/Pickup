export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 640 }}>
      <h1>Pickup</h1>
      <p>
        This app has no UI — it is Twilio, Stripe and cron webhooks. See{" "}
        <code>/api/health</code> for a database connectivity check, and{" "}
        <code>README.md</code> for the runbook.
      </p>
    </main>
  );
}
