#!/bin/bash
# 同步 n8n 組內操作手冊：Obsidian 源頭 → n8n-handbook repo（備份）→ dx-hub → Vercel
#
# 用法：
#   ./scripts/sync-docs.sh              # 用預設的 commit 訊息
#   ./scripts/sync-docs.sh "改了某某段落"   # 自訂 commit 訊息
#
# Tailscale (:3000) 不需要這支腳本，nginx 直接讀 Obsidian 資料夾，存檔即生效。
# 這支腳本只處理「怎麼把同一批文件同步到 dx-hub / Vercel 那份公開版」。

set -euo pipefail

SRC="/Users/thehyyu/Documents/Obsidian/LLM Wiki/Project/n8n組內操作手冊"
DX_HUB="/Users/thehyyu/Documents/dx-hub"
DEST="$DX_HUB/public/n8n-handbook"
MSG="${1:-docs: sync $(date '+%Y-%m-%d %H:%M')}"

if [[ ! -d "$SRC" ]]; then
  echo "找不到源頭資料夾：$SRC" >&2
  exit 1
fi
if [[ ! -d "$DX_HUB" ]]; then
  echo "找不到 dx-hub 資料夾：$DX_HUB" >&2
  exit 1
fi

echo "== 1. 源頭（n8n-handbook repo）commit + push，當作備份 =="
cd "$SRC"
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "$MSG"
  git push
  echo "已 commit + push"
else
  echo "源頭沒有變動，略過"
fi

echo ""
echo "== 2. 複製文件到 dx-hub =="
rsync -av --delete \
  --exclude ".git" \
  --exclude ".gitignore" \
  "$SRC/" "$DEST/"

echo ""
echo "== 3. dx-hub commit + push =="
cd "$DX_HUB"
if [[ -n "$(git status --porcelain public/n8n-handbook)" ]]; then
  git add public/n8n-handbook
  git commit -m "$MSG"
  git push
  echo "已 commit + push"
else
  echo "dx-hub 的文件內容沒有變動，不需要重新部署"
  exit 0
fi

echo ""
echo "== 4. 部署到 Vercel Production =="
vercel --prod

echo ""
echo "完成：https://dx-ops.vercel.app/n8n-handbook"
