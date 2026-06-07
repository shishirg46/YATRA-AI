#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# YatraAI — Ollama Server Setup
# Run this on your cloud VM / VPS as root or with sudo.
# ─────────────────────────────────────────────────────────────

SERVER_IP="$(curl -4 -sf https://ifconfig.me 2>/dev/null || echo '<your-server-ip>')"
MODEL="${OLLAMA_MODEL:-llama3.2}"

echo "=== YatraAI Ollama Server Setup ==="
echo "  Model:         $MODEL"
echo "  Public IP:     $SERVER_IP"
echo ""

# ── 1. Install Ollama ────────────────────────────────────────
if command -v ollama &>/dev/null; then
  echo "[1/5] Ollama already installed at $(command -v ollama)"
else
  echo "[1/5] Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
fi

# ── 2. Configure Ollama service ──────────────────────────────
# Bind to 0.0.0.0 so it's reachable from outside
# (secure with firewall in step 4)
SERVICE_DIR="/etc/systemd/system/ollama.service.d"
if [ ! -f "$SERVICE_DIR/override.conf" ]; then
  echo "[2/5] Configuring Ollama to listen on all interfaces..."
  mkdir -p "$SERVICE_DIR"
  cat > "$SERVICE_DIR/override.conf" << 'OVERRIDE'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
OVERRIDE
  systemctl daemon-reload
fi

echo "[3/5] Restarting Ollama..."
systemctl enable ollama 2>/dev/null || true
systemctl restart ollama
sleep 2

# ── 3. Pull the model ────────────────────────────────────────
echo "[4/5] Pulling model '$MODEL' (this may take a while)..."
ollama pull "$MODEL"

# ── 4. Firewall ──────────────────────────────────────────────
echo "[5/5] Setting up firewall (allow only port 11434)..."
if command -v ufw &>/dev/null; then
  ufw allow 11434/tcp comment 'Ollama'
  ufw --force enable 2>/dev/null || true
elif command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-port=11434/tcp
  firewall-cmd --reload
else
  echo "  No ufw/firewalld found — ensure port 11434 is open in your cloud provider's firewall."
fi

# ── 5. Test ──────────────────────────────────────────────────
echo ""
echo "=== Testing Ollama ==="
sleep 1
if curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
  echo "  Ollama is running and healthy!"
else
  echo "  WARNING: Ollama health check failed. Check: sudo journalctl -u ollama"
fi

echo ""
echo "=== Done ==="
echo ""
echo "Add this to your hosted (Vercel) environment variables:"
echo ""
echo "  AI_PROVIDER=$MODEL"
echo "  OLLAMA_BASE_URL=http://$SERVER_IP:11434"
echo ""
echo "Security: restrict access to your app's IP range in your"
echo "cloud provider's firewall. Ollama has no built-in auth."
echo ""
echo "  sudo ufw allow from <your-app-ip> to any port 11434"
echo "  sudo ufw deny 11434  (for everyone else)"
echo ""
