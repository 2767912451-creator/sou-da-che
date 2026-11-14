#!/usr/bin/env bash
# 搜打撤启动脚本：自动选择合适的 Node 版本并启动服务器
cd "$(dirname "$0")"

NODE_BIN=""
for CAND in "$HOME/.nvm/versions/node"/*/bin/node /usr/local/bin/node /usr/bin/node; do
  if [ -x "$CAND" ]; then
    VER=$("$CAND" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
    if [ "${VER:-0}" -ge 16 ]; then
      NODE_BIN="$(dirname "$CAND")"
      break
    fi
  fi
done

if [ -z "$NODE_BIN" ]; then
  echo "[start] 未找到 Node.js >= 16，请安装后重试"
  exit 1
fi

echo "[start] 使用 Node: $NODE_BIN/node ($("$NODE_BIN/node" -v))"
if [ ! -d node_modules ]; then
  echo "[start] 首次运行，安装依赖..."
  "$NODE_BIN/npm" install --no-audit --no-fund
fi

exec "$NODE_BIN/node" server/index.js
