export default function HomePage() {
  return (
    <main style={{ maxWidth: 480, margin: "15vh auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>DX Ops</h1>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 24 }}>數位轉型組內部資源入口</p>
      <ul style={{ display: "flex", flexDirection: "column", gap: 8, listStyle: "none", padding: 0 }}>
        <li>
          <a href="/n8n-handbook" style={{ color: "#111", textDecoration: "underline" }}>
            n8n 組內操作手冊
          </a>
        </li>
      </ul>
    </main>
  );
}
