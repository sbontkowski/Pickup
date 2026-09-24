import { requestLoginLink } from "./actions";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 420, textAlign: "center" }}>
      <h1>Pickup admin</h1>
      {params.error && <p style={{ color: "#b91c1c" }}>Couldn&apos;t send the login text — try again.</p>}
      {params.sent ? (
        <>
          <p>Check your phone for a login link. It expires in 10 minutes.</p>
          <form action={requestLoginLink} style={{ marginTop: "1rem" }}>
            <button type="submit">Send again</button>
          </form>
        </>
      ) : (
        <form action={requestLoginLink}>
          <button type="submit" style={{ padding: "0.75rem 1.5rem", fontSize: "1rem" }}>
            Text me a login link
          </button>
        </form>
      )}
    </main>
  );
}
