export default async function N8nHandbookLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;

  return (
    <main style={{ maxWidth: 360, margin: "15vh auto", padding: "0 24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>DX Hub</h1>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 24 }}>請輸入密碼繼續</p>
      {error && <p style={{ fontSize: 14, color: "#c00", marginBottom: 16 }}>密碼錯誤，請再試一次</p>}
      <form action="/api/n8n-handbook-login" method="POST" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input type="hidden" name="from" value={from || "/n8n-handbook/"} />
        <input
          type="password"
          name="password"
          placeholder="密碼"
          autoFocus
          required
          style={{ border: "1px solid #ccc", borderRadius: 6, padding: "8px 12px" }}
        />
        <button
          type="submit"
          style={{ background: "#111", color: "#fff", borderRadius: 6, padding: "8px 12px", border: "none", cursor: "pointer" }}
        >
          進入
        </button>
      </form>
    </main>
  );
}
